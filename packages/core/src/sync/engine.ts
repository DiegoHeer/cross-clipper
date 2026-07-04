import { ApiError } from "../api/client";
import type { ApiClient } from "../api/client";
import { ItemCache } from "../cache";
import type { SyncStorage } from "../storage";
import { ReconnectingSocket, type ReconnectOptions, type SocketFactory } from "./socket";
import type { Item } from "../types";

const CURSOR_KEY = "cc.cursor";

export type SyncStatus = "stopped" | "connecting" | "syncing" | "live";

export type SyncEngineEvent =
  | { type: "item"; item: Item }
  | { type: "item_deleted"; itemId: string }
  | { type: "devices_changed" }
  | { type: "status"; status: SyncStatus }
  | { type: "auth_failed" };

type ServerEvent =
  | { type: "item_new"; item: Item }
  | { type: "item_deleted"; item_id: string }
  | { type: "device_changed" }
  | { type: "pong" };

export interface SyncEngineDeps {
  client: ApiClient;
  storage: SyncStorage;
  socketFactory: SocketFactory;
  wsUrl: () => string;
  backoff?: ReconnectOptions;
  pingIntervalMs?: number;
}

export class SyncEngine {
  readonly cache = new ItemCache();

  private cursor: string | null = null;
  private socket: ReconnectingSocket | null = null;
  private syncing = false;
  private resyncQueued = false;
  private buffer: ServerEvent[] = [];
  private listeners: Array<(e: SyncEngineEvent) => void> = [];
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pullAttempt = 0;
  private stopped = true;

  constructor(private readonly deps: SyncEngineDeps) {}

  onEvent(cb: (e: SyncEngineEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.cursor = await this.deps.storage.get(CURSOR_KEY);
    this.socket = new ReconnectingSocket(this.deps.wsUrl, this.deps.socketFactory,
      this.deps.backoff ?? {});
    this.socket.onOpen = () => void this.resync();
    this.socket.onMessage = (m) => this.handleMessage(m as ServerEvent);
    this.socket.onClose = () => {
      this.stopPing();
      this.emit({ type: "status", status: "connecting" });
    };
    this.emit({ type: "status", status: "connecting" });
    this.socket.start();
  }

  stop(): void {
    this.stopped = true;
    this.stopPing();
    clearTimeout(this.retryTimer);
    this.socket?.stop();
    this.socket = null;
    this.emit({ type: "status", status: "stopped" });
  }

  private emit(e: SyncEngineEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private handleMessage(e: ServerEvent): void {
    if (!e || e.type === "pong") return;
    if (this.syncing) {
      this.buffer.push(e);
    } else {
      this.apply(e);
    }
  }

  private apply(e: ServerEvent): void {
    if (e.type === "item_new") {
      // Cursor does NOT advance here — only pulls advance it (see plan §cursor rules).
      if (e.item.deleted_at) {
        if (this.cache.remove(e.item.id)) this.emit({ type: "item_deleted", itemId: e.item.id });
      } else if (this.cache.upsert(e.item)) {
        this.emit({ type: "item", item: e.item });
      }
    } else if (e.type === "item_deleted") {
      if (this.cache.remove(e.item_id)) this.emit({ type: "item_deleted", itemId: e.item_id });
    } else if (e.type === "device_changed") {
      this.emit({ type: "devices_changed" });
    }
  }

  private async resync(): Promise<void> {
    // Cancel any pending pull-retry timer: a wake/nudge (WS onOpen) or queued follow-up
    // must attempt immediately rather than waiting out the current backoff delay.
    clearTimeout(this.retryTimer);
    // Re-entry guard: if a pull is already in-flight, queue exactly one follow-up.
    if (this.syncing) {
      this.resyncQueued = true;
      return;
    }
    this.syncing = true;
    this.resyncQueued = false;
    this.buffer = [];
    this.emit({ type: "status", status: "syncing" });
    try {
      await this.pull();
    } catch (err) {
      this.syncing = false;
      if (this.stopped) return;
      // 401 → auth failure: signal once, stop, never retry.
      if (err instanceof ApiError && err.status === 401) {
        this.emit({ type: "auth_failed" });
        this.stop();
        return;
      }
      this.retryTimer = setTimeout(() => void this.resync(), this.pullBackoffDelay());
      return;
    }
    // Successful pull: reset the attempt counter so the next failure starts fresh.
    this.pullAttempt = 0;
    const buffered = this.buffer;
    this.buffer = [];
    this.syncing = false;
    // If stop() raced in during the await, do not go live.
    if (this.stopped) return;
    for (const e of buffered) this.apply(e);
    this.startPing();
    this.emit({ type: "status", status: "live" });
    // Run exactly one queued follow-up resync if a reconnect arrived mid-pull.
    if (this.resyncQueued) void this.resync();
  }

  /** Exponential backoff delay for pull retries, matching the WS reconnect idiom. */
  private pullBackoffDelay(): number {
    const base = this.deps.backoff?.baseMs ?? 1000;
    const max = this.deps.backoff?.maxMs ?? 30000;
    const random = this.deps.backoff?.random ?? Math.random;
    const delay = Math.min(max, base * 2 ** this.pullAttempt) * (0.5 + random() * 0.5);
    this.pullAttempt++;
    return delay;
  }

  private async pull(): Promise<void> {
    let cursor = this.cursor;
    for (;;) {
      const page = await this.deps.client.listItems({
        cursor: cursor ?? undefined, limit: 100 });
      for (const item of page.items) {
        if (item.deleted_at) {
          if (this.cache.remove(item.id)) this.emit({ type: "item_deleted", itemId: item.id });
        } else if (this.cache.upsert(item)) {
          // Tombstone wins: if the WS buffer already contains a deletion for this item,
          // skip the item event now. The deletion will be emitted when the buffer drains.
          if (!this.bufferHasTombstone(item.id)) {
            this.emit({ type: "item", item });
          }
        }
      }
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      if (cursor) await this.deps.storage.set(CURSOR_KEY, cursor);
    }
  }

  /** Returns true if `buffer` contains an item_deleted event for the given id. */
  private bufferHasTombstone(id: string): boolean {
    return this.buffer.some(
      (e) => e.type === "item_deleted" && e.item_id === id,
    );
  }

  private startPing(): void {
    this.stopPing();
    const interval = this.deps.pingIntervalMs ?? 30000;
    this.pingTimer = setInterval(() => this.socket?.send('{"type":"ping"}'), interval);
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}
