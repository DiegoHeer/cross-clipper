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
    this.items.push(item);
    return item;
  }

  deleteItem(id: string): void {
    const it = this.items.find((i) => i.id === id);
    if (it) {
      it.deleted_at = "2026-07-03T11:00:00";
      it.body = "";
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
      const rows = this.items
        .filter((i) => (cursor ? i.id >= cursor : i.deleted_at === null))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const page = rows.slice(0, limit);
      const next = rows.length > limit ? page[page.length - 1]!.id : null;
      return json(200, { items: page, next_cursor: next });
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
