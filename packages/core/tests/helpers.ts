import type { SocketFactory } from "../src/sync/socket";
import type { WsLike } from "../src/sync/socket";
import type { Item } from "../src/types";

export class FakeSocket implements WsLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  // test-side controls
  serverOpen(): void {
    this.onopen?.();
  }

  serverSend(event: object): void {
    this.onmessage?.(JSON.stringify(event));
  }

  serverDrop(): void {
    this.onclose?.();
  }
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const fakeUlid = (n: number): string =>
  n.toString(36).toUpperCase().padStart(26, "0");

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export class FakeServer {
  items: Item[] = [];
  sockets: FakeSocket[] = [];
  autoOpen = true;
  listDelayMs = 0;
  failNextCreates = 0;                                   // throw TypeError n times
  rejectNextCreateWith: { status: number; code: string } | null = null;
  postAttempts = 0;
  private seq = 0;
  // Monotonic sync_seq: assigned on create, re-assigned on delete (mirrors server repo.py).
  // Stored per item-id so deleteItem can bump it without touching Item type.
  private syncSeq = 0;
  readonly itemSyncSeq = new Map<string, number>();

  private nextSyncSeq(): number {
    return ++this.syncSeq;
  }

  socketFactory: SocketFactory = () => {
    const s = new FakeSocket();
    this.sockets.push(s);
    if (this.autoOpen) queueMicrotask(() => s.serverOpen());
    return s;
  };

  lastSocket(): FakeSocket | undefined {
    return this.sockets[this.sockets.length - 1];
  }

  addItem(body: string, origin = "srv-dev"): Item {
    const item: Item = {
      id: fakeUlid(this.seq++), kind: "text", body, origin_device_id: origin,
      blob_id: null, created_at: "2026-07-03T10:00:00", deleted_at: null,
      target_device_id: null,
    };
    this.itemSyncSeq.set(item.id, this.nextSyncSeq());
    this.items.push(item);
    return item;
  }

  deleteItem(id: string): void {
    const it = this.items.find((i) => i.id === id);
    if (it) {
      it.deleted_at = "2026-07-03T11:00:00";
      it.body = "";
      // Re-assign sync_seq so the tombstone moves ahead of any cursor that
      // already consumed this item when it was live (mirrors server soft_delete).
      this.itemSyncSeq.set(id, this.nextSyncSeq());
    }
  }

  broadcast(event: object): void {
    this.lastSocket()?.serverSend(event);
  }

  fetchFn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/api/v1/items" && method === "GET") {
      if (this.listDelayMs) await sleep(this.listDelayMs);
      const cursor = url.searchParams.get("cursor");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      // Mirror server semantics: filter strictly by sync_seq > cursor (opaque integer string).
      // Without cursor (cold pull): exclude tombstones from initial delivery, matching server
      // include_deleted=false default (items live at the time of the pull).
      const seqCursor = cursor !== null ? (parseInt(cursor, 10) || 0) : null;
      const rows = this.items
        .filter((i) => {
          const seq = this.itemSyncSeq.get(i.id) ?? 0;
          if (seqCursor !== null) return seq > seqCursor;
          return i.deleted_at === null;
        })
        .sort((a, b) => {
          const sa = this.itemSyncSeq.get(a.id) ?? 0;
          const sb = this.itemSyncSeq.get(b.id) ?? 0;
          return sa - sb;
        });
      const page = rows.slice(0, limit);
      if (!page.length) return json(200, { items: [], next_cursor: null });
      // Always return next_cursor as highest delivered seq (mirrors server: always returned
      // when page is non-empty, even on the last page, so future tombstones can be found).
      const maxSeq = this.itemSyncSeq.get(page[page.length - 1]!.id) ?? 0;
      return json(200, { items: page, next_cursor: String(maxSeq) });
    }

    if (url.pathname === "/api/v1/items" && method === "POST") {
      this.postAttempts++;
      if (this.failNextCreates > 0) {
        this.failNextCreates--;
        throw new TypeError("fetch failed");
      }
      if (this.rejectNextCreateWith) {
        const r = this.rejectNextCreateWith;
        this.rejectNextCreateWith = null;
        return json(r.status, { code: r.code, message: r.code });
      }
      const body = JSON.parse(String(init?.body)) as { id?: string; kind: "text" | "link"; body: string };
      const existing = this.items.find((i) => i.id === body.id);
      if (existing) return json(200, existing);
      const item: Item = {
        id: body.id ?? fakeUlid(this.seq++), kind: body.kind, body: body.body,
        origin_device_id: "cli-dev", blob_id: null,
        created_at: "2026-07-03T10:00:00", deleted_at: null,
        target_device_id: null,
      };
      this.items.push(item);
      return json(201, item);
    }

    return json(404, { code: "not_found", message: url.pathname });
  }) as typeof fetch;
}
