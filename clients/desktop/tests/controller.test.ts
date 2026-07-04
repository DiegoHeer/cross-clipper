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

  it("undo while queued (server blocked on A, undo B) — B never persists, toast shows cancelled", async () => {
    // Strategy: entry A is in-flight (blocking server), entry B is behind A (index 1, attempts=0).
    // undo_capture for B: since flushing=true (A in-flight), cancel() returns false → pendingCancelIds.
    // When A succeeds and B is subsequently delivered, pendingCancelIds fires: B is deleted,
    // toast_update "cancelled" is broadcast. Net: B never persists on the server.
    let resolveA!: (v: unknown) => void;
    const pendingPosts: Array<{ id: string; resolve: (v: unknown) => void }> = [];
    const allDeleted: string[] = [];

    const controlledFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/v1/items") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ items: [], next_cursor: null }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/api/v1/items") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        const id = body["id"] as string;
        return new Promise<Response>((resolve) => {
          pendingPosts.push({
            id,
            resolve: (v: unknown) => {
              void v;
              resolve(new Response(JSON.stringify({
                id,
                kind: body["kind"],
                body: body["body"],
                origin_device_id: "self",
                target_device_id: null,
                blob_id: null,
                created_at: "2026-07-03T00:00:00",
                deleted_at: null,
              }), { status: 201, headers: { "content-type": "application/json" } }));
            },
          });
        });
      }
      const deleteMatch = u.match(/\/api\/v1\/items\/([^/?]+)$/);
      if (deleteMatch && init?.method === "DELETE") {
        allDeleted.push(deleteMatch[1]!);
        return new Response(null, { status: 204 });
      }
      if (u.includes("/api/v1/devices")) {
        return new Response(JSON.stringify({ devices: [] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as typeof fetch;

    FakeSocket.instances = [];
    const storage = new MemoryStorage();
    await storage.set("cc.auth", AUTH);
    const { BackgroundController } = await import("../src/background/controller");
    const controller = new BackgroundController({
      storage,
      socketFactory: (url) => new FakeSocket(url) as never,
      fetchFn: controlledFetch,
    });
    await controller.wake();

    const workerEvents: import("../src/shared/messages").WorkerEvent[] = [];
    await subscribeEvents((e) => workerEvents.push(e));

    // Send A — POST starts and blocks
    const resA = (await controller.handleRequest({
      type: "send", kind: "text", body: "entry-A", targetDeviceId: null,
    })) as { outboxId: string };
    const idA = resA.outboxId;

    // Wait for A's POST to start
    await new Promise((r) => setTimeout(r, 5));

    // Send B — queued behind A
    const resB = (await controller.handleRequest({
      type: "send", kind: "text", body: "entry-B", targetDeviceId: null,
    })) as { outboxId: string };
    const idB = resB.outboxId;

    // Undo B — flushing=true (A in-flight) → cancel(B) returns false → pendingCancelIds
    await controller.handleRequest({ type: "undo_capture", outboxId: idB });

    // Unblock A → A delivers. B flushes next → B delivers → pendingCancelIds fires → DELETE B
    const postA = pendingPosts.find((p) => p.id === idA);
    postA?.resolve(undefined);
    await new Promise((r) => setTimeout(r, 20));

    // Unblock B if it started a POST
    const postB = pendingPosts.find((p) => p.id === idB);
    postB?.resolve(undefined);
    await new Promise((r) => setTimeout(r, 20));

    // B must have been deleted (pendingCancelIds path fired on B's delivery)
    expect(allDeleted).toContain(idB);

    // toast_update "cancelled" must have been broadcast for B
    const toastEvents = workerEvents.filter(
      (e) => e.type === "toast_update" && (e as { outboxId?: string }).outboxId === idB,
    );
    expect(toastEvents.length).toBeGreaterThan(0);
    expect(toastEvents[0]).toMatchObject({ type: "toast_update", state: "cancelled" });
    void resolveA; // suppress unused var warning
  });

  it("undo racing delivery → exactly one deleteItem after ack, no double-delete", async () => {
    let resolvePost!: (item: unknown) => void;
    const postControlled = new Promise<unknown>((r) => { resolvePost = r; });
    const deleted: string[] = [];
    let postCalled = false;

    const racingFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/v1/items") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ items: [], next_cursor: null }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/api/v1/items") && init?.method === "POST") {
        postCalled = true;
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        // Block until test resolves
        await postControlled;
        return new Response(JSON.stringify({
          id: body["id"] ?? "srv01",
          kind: body["kind"],
          body: body["body"],
          origin_device_id: "self",
          target_device_id: null,
          blob_id: null,
          created_at: "2026-07-03T00:00:00",
          deleted_at: null,
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      const deleteMatch = u.match(/\/api\/v1\/items\/([^/?]+)$/);
      if (deleteMatch && init?.method === "DELETE") {
        deleted.push(deleteMatch[1]!);
        return new Response(null, { status: 204 });
      }
      if (u.includes("/api/v1/devices")) {
        return new Response(JSON.stringify({ devices: [] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as typeof fetch;

    FakeSocket.instances = [];
    const storage = new MemoryStorage();
    await storage.set("cc.auth", AUTH);
    const captureResults: Array<{ state: string; snippet?: string; outboxId?: string }> = [];
    const { BackgroundController } = await import("../src/background/controller");
    const controller = new BackgroundController({
      storage,
      socketFactory: (url) => new FakeSocket(url) as never,
      fetchFn: racingFetch,
      onCaptureResult: (r) => captureResults.push(r),
    });
    await controller.wake();

    // Capture — POST is blocked
    await controller.handleCapture({ kind: "text", text: "race me" });
    // Wait for POST to start
    await new Promise((r) => setTimeout(r, 5));
    expect(postCalled).toBe(true);

    const outboxId = captureResults[0]?.outboxId;
    expect(outboxId).toBeTruthy();

    // Issue undo while POST is in-flight (cancel returns false → pendingCancelIds)
    await controller.handleRequest({ type: "undo_capture", outboxId: outboxId! });

    // Now unblock the POST — delivery fires, pendingCancelIds path deletes
    resolvePost(undefined);
    await new Promise((r) => setTimeout(r, 20));

    // Exactly one DELETE
    expect(deleted).toHaveLength(1);
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

  it("window_opened calls onWindowOpened hook → setTrayState(false) via fake", async () => {
    FakeSocket.instances = [];
    const storage = new MemoryStorage();
    const onWindowOpened = vi.fn();
    const { BackgroundController } = await import("../src/background/controller");
    const controller = new BackgroundController({
      storage,
      socketFactory: (url) => new FakeSocket(url) as never,
      fetchFn: makeFetch().fetchFn,
      onWindowOpened,
    });
    await controller.handleRequest({ type: "window_opened" });
    expect(onWindowOpened).toHaveBeenCalledOnce();
  });

  it("pendingCancelIds persists across restarts — delivery ack on restart fires DELETE + toast_update cancelled", async () => {
    // Scenario: undo arrives while POST is in-flight. App restarts before server acks.
    // On restart, pendingCancelIds is loaded from cc.pendingCancels before outbox flushes,
    // so the delivery ack on the new controller still triggers the cancel path.

    let resolvePost!: () => void;
    const deleted: string[] = [];
    const workerEvents: import("../src/shared/messages").WorkerEvent[] = [];

    const controlledFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/v1/items") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ items: [], next_cursor: null }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/api/v1/items") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        await new Promise<void>((r) => { resolvePost = r; });
        return new Response(JSON.stringify({
          id: body["id"] as string,
          kind: body["kind"],
          body: body["body"],
          origin_device_id: "self",
          target_device_id: null,
          blob_id: null,
          created_at: "2026-07-03T00:00:00",
          deleted_at: null,
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      const deleteMatch = u.match(/\/api\/v1\/items\/([^/?]+)$/);
      if (deleteMatch && init?.method === "DELETE") {
        deleted.push(deleteMatch[1]!);
        return new Response(null, { status: 204 });
      }
      if (u.includes("/api/v1/devices")) {
        return new Response(JSON.stringify({ devices: [] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as typeof fetch;

    // --- Session 1: capture, block POST, user clicks undo (in-flight race path) ---
    FakeSocket.instances = [];
    const storage = new MemoryStorage();
    await storage.set("cc.auth", AUTH);
    const captureResults1: Array<{ state: string; snippet?: string; outboxId?: string }> = [];
    const { BackgroundController } = await import("../src/background/controller");
    const ctrl1 = new BackgroundController({
      storage,
      socketFactory: (url) => new FakeSocket(url) as never,
      fetchFn: controlledFetch,
      onCaptureResult: (r) => captureResults1.push(r),
    });
    await ctrl1.wake();

    await ctrl1.handleCapture({ kind: "text", text: "persist-me" });
    // Wait for POST to start (outbox is flushing)
    await new Promise((r) => setTimeout(r, 5));

    const outboxId = captureResults1[0]?.outboxId;
    expect(outboxId).toBeTruthy();

    // Undo while in-flight → pendingCancelIds.add, saved to cc.pendingCancels
    await ctrl1.handleRequest({ type: "undo_capture", outboxId: outboxId! });

    // Verify cc.pendingCancels was persisted
    const saved = await storage.get("cc.pendingCancels");
    expect(JSON.parse(saved ?? "[]")).toContain(outboxId);

    // --- Simulate restart: new controller over same storage ---
    FakeSocket.instances = [];
    await subscribeEvents((e) => workerEvents.push(e));

    const ctrl2 = new BackgroundController({
      storage,
      socketFactory: (url) => new FakeSocket(url) as never,
      fetchFn: controlledFetch,
    });
    // doWake loads cc.pendingCancels BEFORE outbox.load / outbox.flush
    await ctrl2.wake();

    // Now unblock the POST — ctrl2's outbox picks it up and delivers
    resolvePost();
    await new Promise((r) => setTimeout(r, 30));

    // DELETE must have been issued (pendingCancelIds path fired on delivery)
    expect(deleted).toContain(outboxId);

    // toast_update "cancelled" must have been broadcast
    const cancelToasts = workerEvents.filter(
      (e) =>
        e.type === "toast_update" &&
        (e as { outboxId?: string }).outboxId === outboxId,
    );
    expect(cancelToasts.length).toBeGreaterThan(0);
    expect(cancelToasts[0]).toMatchObject({ type: "toast_update", state: "cancelled" });
  });
});
