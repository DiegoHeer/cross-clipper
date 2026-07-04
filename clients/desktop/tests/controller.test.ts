import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import { __resetEvents } from "./tauriMock";
import { subscribeEvents, requestBackground } from "../src/shared/bridge";
import type { WorkerEvent, StateSnapshot } from "../src/shared/messages";

// ---------------------------------------------------------------------------
// FakeSocket — implements core's WsLike, driven by tests
// ---------------------------------------------------------------------------
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(d: string): void {
    this.sent.push(d);
  }

  close(): void {
    this.onclose?.();
  }

  // Test helpers
  open(): void {
    this.onopen?.();
  }

  push(msg: unknown): void {
    this.onmessage?.(JSON.stringify(msg));
  }
}

// ---------------------------------------------------------------------------
// makeFetch — minimal fake server: items pages + create + delete + devices
// ---------------------------------------------------------------------------
const item = (id: string, over?: Partial<Item>): Item =>
  ({
    id,
    kind: "text",
    body: id,
    origin_device_id: "d2",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(pages: Item[][] = [[]]) {
  const created: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  let page = 0;

  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/v1/items") && (!init?.method || init.method === "GET")) {
      const items = pages[page] ?? [];
      page++;
      return jsonResponse({ items, next_cursor: null });
    }
    if (u.includes("/api/v1/items") && init?.method === "POST") {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      created.push(body);
      return jsonResponse({
        id: body["id"] ?? "srv01",
        kind: body["kind"],
        body: body["body"],
        origin_device_id: "self",
        target_device_id: body["target_device_id"] ?? null,
        blob_id: null,
        created_at: "2026-07-03T00:00:00",
        deleted_at: null,
      });
    }
    // DELETE /items/:id
    const deleteMatch = u.match(/\/api\/v1\/items\/([^/?]+)$/);
    if (deleteMatch && init?.method === "DELETE") {
      deleted.push(deleteMatch[1]!);
      return new Response(null, { status: 204 });
    }
    if (u.includes("/api/v1/devices")) {
      return jsonResponse({ devices: [{ id: "self", name: "me", platform: "windows", online: true, last_seen_at: "2026-07-03T00:00:00" }] });
    }
    return jsonResponse({ error: "not_found", message: u }, 404);
  }) as typeof fetch;

  return { fetchFn, created, deleted };
}

// ---------------------------------------------------------------------------
// makeController — wires up BackgroundController with fakes
// ---------------------------------------------------------------------------
const AUTH = JSON.stringify({
  baseUrl: "http://s",
  token: "tok",
  deviceId: "self",
  deviceName: "me",
});

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function makeController(
  storageSeed: Record<string, string>,
  pages: Item[][] = [[]],
) {
  FakeSocket.instances = [];
  const storage = new MemoryStorage();
  for (const [k, v] of Object.entries(storageSeed)) await storage.set(k, v);
  const { fetchFn, created, deleted } = makeFetch(pages);
  const onNewItem = vi.fn();
  const captureResults: Array<{ state: string; snippet?: string; outboxId?: string }> = [];
  const onCaptureResult = vi.fn((r: { state: string; snippet?: string; outboxId?: string }) => {
    captureResults.push(r);
  });

  const { BackgroundController } = await import("../src/background/controller");
  const controller = new BackgroundController({
    storage,
    socketFactory: (url) => new FakeSocket(url) as never,
    fetchFn,
    onNewItem,
    onCaptureResult,
  });
  return { controller, created, deleted, onNewItem, captureResults, onCaptureResult, storage };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BackgroundController (desktop)", () => {
  beforeEach(() => {
    __resetEvents();
    vi.restoreAllMocks();
  });

  it("without auth, wake is a no-op and the snapshot is unauthenticated", async () => {
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

  it("wake is idempotent — concurrent calls start only one engine", async () => {
    const { controller } = await makeController({ "cc.auth": AUTH });
    await Promise.all([controller.wake(), controller.wake()]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("pulled items persist and fire the new-item hook once (WS echo does not re-fire)", async () => {
    const { controller, onNewItem } = await makeController(
      { "cc.auth": AUTH },
      [[item("01A")]],
    );
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    expect((await controller.snapshot()).items.map((i) => i.id)).toEqual(["01A"]);
    expect(onNewItem).toHaveBeenCalledTimes(1);
    // WS echo — duplicate must not re-fire the hook
    FakeSocket.instances[0]!.push({ type: "item_new", item: item("01A") });
    await flush();
    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it("status events broadcast via the bridge", async () => {
    const events: WorkerEvent[] = [];
    await subscribeEvents((e) => events.push(e));

    const { controller } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    // After WS open, engine emits status=live → should broadcast
    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents.length).toBeGreaterThan(0);
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

  it("capture of text sends UNTARGETED through the outbox and reports a result", async () => {
    const { controller, created, captureResults } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    await controller.handleCapture({ kind: "text", text: "  captured note  " });
    await flush();
    expect(created[0]).toMatchObject({ body: "captured note" });
    expect("target_device_id" in (created[0] ?? {})).toBe(false);
    expect(captureResults[0]).toMatchObject({
      state: expect.stringMatching(/synced|queued/),
    });
  });

  it("capture of sensitive/empty/unsupported clipboard sends nothing", async () => {
    const { controller, created, captureResults } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    for (const kind of ["sensitive", "empty", "unsupported"] as const) {
      await controller.handleCapture({ kind });
    }
    await flush();
    expect(created).toHaveLength(0);
    expect(captureResults.map((r) => r.state)).toEqual(["sensitive", "empty", "unsupported"]);
  });

  it("undo of a delivered capture deletes the item; sign_out wipes state", async () => {
    const { controller, deleted, captureResults, storage } = await makeController({
      "cc.auth": AUTH,
    });
    await controller.wake();
    await controller.handleCapture({ kind: "text", text: "undo me" });
    await flush();

    // The capture must have been delivered (synced) or queued
    const result = captureResults[0];
    expect(result).toBeDefined();

    if (result?.state === "synced" && result.outboxId) {
      // Delivered path: undo should DELETE the item
      await controller.handleRequest({ type: "undo_capture", outboxId: result.outboxId });
      await flush();
      expect(deleted).toHaveLength(1);
    }
    // Either way, sign_out should wipe state
    await controller.handleRequest({ type: "sign_out" });
    const snap = await controller.snapshot();
    expect(snap.authed).toBe(false);
    expect(snap.items).toHaveLength(0);
    // Sentinel writes
    const items = await storage.get("cc.items");
    expect(items === null || items === "" || JSON.parse(items ?? "[]").length === 0).toBe(true);
  });

  it("get_state returns the snapshot via handleRequest", async () => {
    const { controller } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const snap = (await controller.handleRequest({ type: "get_state" })) as StateSnapshot;
    expect(snap.authed).toBe(true);
  });

  it("requestBackground round-trips via the bridge", async () => {
    const { controller } = await makeController({ "cc.auth": AUTH });
    await controller.wake();

    // Wire up serveRequests
    const { serveRequests } = await import("../src/shared/bridge");
    await serveRequests((req) => controller.handleRequest(req));

    const snap = await requestBackground<StateSnapshot>({ type: "get_state" });
    expect(snap.authed).toBe(true);
  });
});
