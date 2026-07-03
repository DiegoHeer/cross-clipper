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
  | { type: "status"; status: SyncStatus };

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
  private buffer: ServerEvent[] = [];
  private listeners: Array<(e: SyncEngineEvent) => void> = [];
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.syncing = true;
    this.buffer = [];
    this.emit({ type: "status", status: "syncing" });
    try {
      await this.pull();
    } catch {
      if (this.stopped) return;
      this.retryTimer = setTimeout(() => void this.resync(),
        this.deps.backoff?.baseMs ?? 1000);
      return;
    }
    const buffered = this.buffer;
    this.buffer = [];
    this.syncing = false;
    for (const e of buffered) this.apply(e);
    this.startPing();
    this.emit({ type: "status", status: "live" });
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
          this.emit({ type: "item", item });
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
