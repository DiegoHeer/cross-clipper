import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import { setFakeBrowser } from "./polyfillMock";
import { makeFakeBrowser, type FakePort } from "./fakeBrowser";

// FakeSocket implementing core's WsLike, driven by tests.
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
  open() {
    this.onopen?.();
  }
  push(ev: unknown) {
    this.onmessage?.(JSON.stringify(ev));
  }
}

const AUTH = JSON.stringify({ baseUrl: "http://s", token: "tok", deviceId: "self", deviceName: "me" });

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, kind: "text", body: id, origin_device_id: "d2", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null, ...over }) as Item;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** Minimal fake server: items page + create + devices. */
function makeFetch(pages: Item[][]) {
  const created: Record<string, unknown>[] = [];
  let page = 0;
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/items") && (!init || init.method === undefined || init.method === "GET")) {
      const items = pages[Math.min(page, pages.length - 1)] ?? [];
      page++;
      return jsonResponse({ items, next_cursor: null });
    }
    if (u.includes("/items") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created.push(body);
      return jsonResponse(item(body.id as string, { body: body.body as string, origin_device_id: "self" }), 201);
    }
    if (u.includes("/devices")) return jsonResponse({ devices: [{ id: "self", name: "me", platform: "extension", online: true, last_seen_at: "2026-07-03T00:00:00", created_at: "2026-07-01T00:00:00" }] });
    if (u.endsWith(`/items/01DEL`)) return new Response(null, { status: 204 });
    return jsonResponse({ code: "not_found", message: u }, 404);
  }) as typeof fetch;
  return { fetchFn, created };
}

async function makeController(storageSeed: Record<string, string>, pages: Item[][] = [[]]) {
  FakeSocket.instances = [];
  const fake = makeFakeBrowser();
  setFakeBrowser(fake.browser);
  const storage = new MemoryStorage();
  for (const [k, v] of Object.entries(storageSeed)) await storage.set(k, v);
  const { fetchFn, created } = makeFetch(pages);
  const onNewItem = vi.fn();
  const { BackgroundController } = await import("../src/background/controller");
  const controller = new BackgroundController({
    storage,
    socketFactory: (url) => new FakeSocket(url) as never,
    fetchFn,
    onNewItem,
  });
  return { controller, created, onNewItem, fake, storage };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BackgroundController", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("without auth, wake is a no-op and the snapshot says unauthenticated", async () => {
    const { controller } = await makeController({});
    await controller.wake();
    expect(FakeSocket.instances).toHaveLength(0);
    const snap = await controller.snapshot();
    expect(snap.authed).toBe(false);
  });

  it("with auth, wake starts the engine against the ws url with the token", async () => {
    const { controller } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    expect(FakeSocket.instances[0]!.url).toBe("ws://s/api/v1/ws?token=tok");
  });

  it("pulled items land in the persisted feed and fire the new-item hook once", async () => {
    const { controller, onNewItem } = await makeController({ "cc.auth": AUTH }, [[item("01A")]]);
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    const snap = await controller.snapshot();
    expect(snap.items.map((i) => i.id)).toEqual(["01A"]);
    expect(onNewItem).toHaveBeenCalledTimes(1);
    // duplicate delivery (WS echo after pull) does not re-fire
    FakeSocket.instances[0]!.push({ type: "item_new", item: item("01A") });
    await flush();
    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it("send goes through the outbox with the target and answers the outbox id", async () => {
    const { controller, created } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const res = (await controller.handleRequest({
      type: "send",
      kind: "text",
      body: "hello",
      targetDeviceId: "d2",
    })) as { outboxId: string };
    await flush();
    expect(res.outboxId).toBeTruthy();
    expect(created[0]).toMatchObject({ body: "hello", target_device_id: "d2" });
  });

  it("port connect pushes a snapshot event immediately", async () => {
    const { controller, fake } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const port = fake.makePort("cc-events") as FakePort;
    await controller.onPortConnect(port as never);
    expect(port.sent[0]).toMatchObject({ type: "snapshot", state: { authed: true } });
  });

  it("live WS events broadcast to connected ports", async () => {
    const { controller, fake } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const port = fake.makePort("cc-events") as FakePort;
    await controller.onPortConnect(port as never);
    FakeSocket.instances[0]!.open();
    await flush();
    FakeSocket.instances[0]!.push({ type: "item_new", item: item("01B") });
    await flush();
    expect(port.sent.some((m) => (m as { type: string }).type === "item")).toBe(true);
  });

  it("sign_out wipes auth, feed, cursor and outbox and reports unauthenticated", async () => {
    const { controller, storage } = await makeController({ "cc.auth": AUTH }, [[item("01A")]]);
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    await controller.handleRequest({ type: "sign_out" });
    expect((await controller.snapshot()).authed).toBe(false);
    expect(await storage.get("cc.cursor")).toBeNull();
    expect(JSON.parse((await storage.get("cc.items")) ?? "[]")).toEqual([]);
  });
});
