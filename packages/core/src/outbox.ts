import { ulid } from "ulidx";

import { ApiError, NetworkError, type ApiClient } from "./api/client";
import type { SyncStorage } from "./storage";
import type { Item } from "./types";

const OUTBOX_KEY = "cc.outbox";

export interface OutboxEntry {
  id: string;                 // client-generated ULID = idempotency key
  kind: "text" | "link";
  body: string;
  attempts: number;
}

export type OutboxEvent =
  | { type: "delivered"; item: Item }
  | { type: "rejected"; entry: OutboxEntry; error: ApiError }   // 4xx (except 401): dropped
  | { type: "auth_required" };                                  // 401: entry kept, flushing halted

export interface OutboxDeps {
  client: ApiClient;
  storage: SyncStorage;
  onEvent?: (e: OutboxEvent) => void;
  ulidFn?: () => string;      // injected in tests
  baseMs?: number;            // retry backoff base, default 1000
  maxMs?: number;             // retry backoff cap, default 30000
}

export class Outbox {
  private entries: OutboxEntry[] = [];
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly deps: OutboxDeps) {}

  async load(): Promise<void> {
    const raw = await this.deps.storage.get(OUTBOX_KEY);
    this.entries = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  }

  pending(): OutboxEntry[] {
    return [...this.entries];
  }

  async send(kind: "text" | "link", body: string): Promise<string> {
    const id = (this.deps.ulidFn ?? ulid)();
    this.entries.push({ id, kind, body, attempts: 0 });
    await this.persist();
    void this.flush();
    return id;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    try {
      while (this.entries.length > 0 && !this.stopped) {
        const entry = this.entries[0]!;
        try {
          const item = await this.deps.client.createItem(
            { id: entry.id, kind: entry.kind, body: entry.body });
          this.entries.shift();
          await this.persist();
          this.deps.onEvent?.({ type: "delivered", item });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            this.deps.onEvent?.({ type: "auth_required" });
            return; // entry kept; caller re-auths, then calls flush() again
          }
          if (err instanceof ApiError && err.status < 500) {
            this.entries.shift();
            await this.persist();
            this.deps.onEvent?.({ type: "rejected", entry, error: err });
            continue;
          }
          if (err instanceof NetworkError || err instanceof ApiError) {
            entry.attempts++;
            await this.persist();
            this.scheduleRetry(entry.attempts);
            return;
          }
          throw err; // programmer error — never swallow
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry(attempts: number): void {
    if (this.stopped) return;
    const base = this.deps.baseMs ?? 1000;
    const max = this.deps.maxMs ?? 30000;
    const delay = Math.min(max, base * 2 ** (attempts - 1));
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), delay);
  }

  private async persist(): Promise<void> {
    await this.deps.storage.set(OUTBOX_KEY, JSON.stringify(this.entries));
  }
}
