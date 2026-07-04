import { ulid } from "ulidx";

import { ApiError, NetworkError, type ApiClient } from "./api/client";
import type { SyncStorage } from "./storage";
import type { Item } from "./types";

const OUTBOX_KEY = "cc.outbox";

export interface OutboxEntry {
  id: string;                 // client-generated ULID = idempotency key
  kind: "text" | "link";
  body: string;
  target_device_id?: string;  // optional notification target (not visibility filter)
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

/**
 * Outbox: a persistent queue for clipboard items.
 *
 * On 401 the flush halts with one `auth_required` event and the queue is
 * preserved. Flushing does not auto-resume — the consumer calls `flush()`
 * after re-authenticating. A `send()` issued while halted persists the entry
 * and may emit a further `auth_required` (each flush attempt against an
 * invalid token signals once).
 */
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

  async send(kind: "text" | "link", body: string, targetDeviceId?: string): Promise<string> {
    const id = (this.deps.ulidFn ?? ulid)();
    const entry: OutboxEntry = { id, kind, body, attempts: 0 };
    if (targetDeviceId) entry.target_device_id = targetDeviceId;
    this.entries.push(entry);
    await this.persist();
    void this.flush();
    return id;
  }

  /**
   * Enqueue an entry with a PRE-ASSIGNED id (App Group drain path).
   *
   * Used when draining the share-extension outbox mirror into the main app's
   * Outbox. The caller supplies the same client ULID that was used in the
   * extension's failed POST — preserving idempotency (system spec §8).
   *
   * Idempotent: if an entry with the given id already exists, this is a no-op
   * (drain-after-crash could double-add).
   */
  async enqueue(entry: {
    id: string;
    kind: "text" | "link";
    body: string;
    targetDeviceId?: string | null;
  }): Promise<void> {
    // Idempotency check — skip if already queued.
    if (this.entries.some((e) => e.id === entry.id)) return;
    const outboxEntry: OutboxEntry = { id: entry.id, kind: entry.kind, body: entry.body, attempts: 0 };
    if (entry.targetDeviceId) outboxEntry.target_device_id = entry.targetDeviceId;
    this.entries.push(outboxEntry);
    await this.persist();
    void this.flush();
  }

  /**
   * Cancel a queued entry by id before it has been sent to the server.
   *
   * Returns `true` if the entry was found and removed; `false` if:
   *   - A flush is currently in progress (`flushing === true`), OR
   *   - The head entry (`entries[0]`) has already been attempted at least once
   *     — even between retries `flushing` is false, but the entry may have
   *     reached the server and we cannot safely cancel it, OR
   *   - No entry with that id exists.
   *
   * Entries beyond index 0 are safe to cancel at any time because the outbox
   * processes FIFO and they can never have been POSTed while a prior entry
   * is still at the head.
   */
  async cancel(id: string): Promise<boolean> {
    if (this.flushing) return false;
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    // Head entry with attempts > 0 has already been POSTed at least once —
    // refuse to cancel even though flushing is false (we're between retries).
    if (idx === 0 && this.entries[0]!.attempts > 0) return false;
    this.entries.splice(idx, 1);
    await this.persist();
    return true;
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
          const item = await this.deps.client.createItem({
            id: entry.id,
            kind: entry.kind,
            body: entry.body,
            ...(entry.target_device_id ? { target_device_id: entry.target_device_id } : {}),
          });
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
