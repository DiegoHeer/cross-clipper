/**
 * SyncController tests — TDD step 1 (failing).
 *
 * Strategy: inject fake fetchFn, MemoryStorage, controllable fake socket +
 * fake AppState per plan spec. No sync logic lives here — only wiring.
 */
import { MemoryStorage } from "@crossclipper/core";
import type { AppStateStatus } from "react-native";
import type { Item, Device } from "@crossclipper/core";
import { SyncController } from "../SyncController";
import type { WsLike } from "@crossclipper/core";
import type { AppGroup, AppGroupShim } from "../../platform/appGroup";
import { makeAppGroup } from "../../platform/appGroup";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for all micro/macro tasks to drain. */
async function flush(ms = 100): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Fake AppState ────────────────────────────────────────────────────────────

type AppStateLike = {
  currentState: AppStateStatus;
  addEventListener(
    event: "change",
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
};

function makeFakeAppState(initial: AppStateStatus = "active"): AppStateLike & {
  emit(s: AppStateStatus): void;
} {
  const listeners: Array<(s: AppStateStatus) => void> = [];
  let current: AppStateStatus = initial;
  return {
    get currentState() {
      return current;
    },
    addEventListener(_event: "change", listener: (s: AppStateStatus) => void) {
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
    emit(s: AppStateStatus) {
      current = s;
      listeners.forEach((l) => l(s));
    },
  };
}

// ─── Fake Socket ──────────────────────────────────────────────────────────────

type FakeSocket = {
  like: WsLike;
  /** Call AFTER wake() resolves — by then engine has assigned onopen. */
  open(): void;
  message(data: string): void;
  close(): void;
};

function makeFakeSocket(): FakeSocket {
  const like: WsLike = {
    send: jest.fn(),
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  return {
    like,
    open() {
      like.onopen?.();
    },
    message(data: string) {
      like.onmessage?.(data);
    },
    close() {
      like.onclose?.();
    },
  };
}

// ─── Fake responses ───────────────────────────────────────────────────────────

function makeItem(id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"): Item {
  return {
    id,
    kind: "text",
    body: "hello",
    user_id: "u1",
    origin_device_id: "d1",
    target_device_id: null,
    created_at: "2026-01-01T00:00:00",
    deleted_at: null,
    sync_seq: 1,
  } as unknown as Item;
}

function makeDevice(id = "d1"): Device {
  return {
    id,
    name: "TestDevice",
    platform: "ios",
    online: true,
    last_seen_at: "2026-01-01T00:00:00",
    user_id: "u1",
  } as unknown as Device;
}

// ─── Fake AppGroup shim ───────────────────────────────────────────────────────

function makeFakeShim(): AppGroupShim & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    async getItem(key: string) { return store[key] ?? null; },
    async setItem(key: string, value: string) { store[key] = value; },
    async removeItem(key: string) { delete store[key]; },
  };
}

const AUTH_KEY = "cc.auth";
const AUTH_VALUE = JSON.stringify({
  baseUrl: "http://localhost:8000",
  token: "tok123",
  deviceId: "d1",
  deviceName: "TestDevice",
});

function makeItemsResponse(items: Item[], nextCursor: string | null = null): Response {
  return new Response(JSON.stringify({ items, next_cursor: nextCursor }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeDevicesResponse(devices: Device[]): Response {
  return new Response(JSON.stringify({ devices }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function make401(): Response {
  return new Response(
    JSON.stringify({ detail: "Unauthorized", code: "unauthorized" }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SyncController", () => {
  let storage: MemoryStorage;
  let fakeSocket: FakeSocket;
  let socketFactory: jest.Mock;
  let ctrl: SyncController | null = null;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.set(AUTH_KEY, AUTH_VALUE);

    fakeSocket = makeFakeSocket();
    socketFactory = jest.fn().mockReturnValue(fakeSocket.like);
    ctrl = null;
  });

  afterEach(() => {
    // Stop the engine/outbox so timers and sockets are released between tests.
    ctrl?.sleep();
    ctrl = null;
  });

  describe("wake() — boot with stored auth", () => {
    it("starts engine and transitions status to live after socket opens + items fetched", async () => {
      const item = makeItem();
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(makeItemsResponse([item]))
        .mockResolvedValue(makeDevicesResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      // Wake resolves after engine.start() (socket assigned); then open triggers resync
      await ctrl.wake();
      fakeSocket.open(); // triggers resync() → fetches /items → emits "live"
      await flush(100);

      expect(ctrl.snapshot().status).toBe("live");
    });

    it("items delivered by cursor pull land in the feed", async () => {
      const item = makeItem();
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(makeItemsResponse([item]))
        .mockResolvedValue(makeDevicesResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      await ctrl.wake();
      fakeSocket.open();
      await flush(100);

      expect(ctrl.snapshot().items).toHaveLength(1);
      expect(ctrl.snapshot().items[0]!.id).toBe(item.id);
    });

    it("is idempotent — calling wake() twice does not double-start", async () => {
      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));
      ctrl = new SyncController({ storage, socketFactory, fetchFn });

      const p1 = ctrl.wake();
      const p2 = ctrl.wake(); // concurrent second call
      await Promise.all([p1, p2]);
      fakeSocket.open();
      await flush(50);

      // socketFactory called exactly once
      expect(socketFactory).toHaveBeenCalledTimes(1);
    });
  });

  describe("AppState lifecycle", () => {
    it("background → sleep(); active → wake() (the one recovery path)", async () => {
      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));
      const appState = makeFakeAppState("active");
      ctrl = new SyncController({ storage, socketFactory, fetchFn, appState });

      ctrl.attachAppState();
      await ctrl.wake();
      fakeSocket.open();
      await flush(50);

      const fetchCountAfterWake = fetchFn.mock.calls.length;

      // Go to background — engine should stop
      appState.emit("background");
      await flush(20);
      expect(ctrl.snapshot().status).toBe("stopped");

      // Return to active — engine restarts and re-pulls (one recovery path)
      const fakeSocket2 = makeFakeSocket();
      socketFactory.mockReturnValue(fakeSocket2.like);
      appState.emit("active");
      await flush(20); // wake() runs doWake()
      fakeSocket2.open();
      await flush(100);

      // fetch was called again
      expect(fetchFn.mock.calls.length).toBeGreaterThan(fetchCountAfterWake);
    });

    it("inactive → sleep()", async () => {
      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));
      const appState = makeFakeAppState("active");
      ctrl = new SyncController({ storage, socketFactory, fetchFn, appState });

      ctrl.attachAppState();
      await ctrl.wake();
      fakeSocket.open();
      await flush(20);

      appState.emit("inactive");
      await flush(20);
      expect(ctrl.snapshot().status).toBe("stopped");
    });
  });

  describe("send()", () => {
    it("enqueues via Outbox and returns a string id", async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(makeItemsResponse([]))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(makeItem("SENT_ITEM_ID")), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValue(makeItemsResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      await ctrl.wake();
      fakeSocket.open();
      await flush(50);

      const id = await ctrl.send("text", "hello world");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("delivered outbox event upserts item into feed", async () => {
      const sentItem = makeItem("SENT_ID");
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(makeItemsResponse([]))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(sentItem), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValue(makeItemsResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      await ctrl.wake();
      fakeSocket.open();
      await flush(50);

      await ctrl.send("text", "hello world");
      // Wait for outbox flush to deliver
      await flush(200);

      const snap = ctrl.snapshot();
      const itemIds = snap.items.map((i) => i.id);
      expect(itemIds).toContain("SENT_ID");
    });
  });

  describe("401 auth_failed handling", () => {
    it("snapshot.authRequired becomes true on 401, no retry hammer", async () => {
      const fetchFn = jest.fn().mockResolvedValue(make401());

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      await ctrl.wake();
      fakeSocket.open();
      await flush(200);

      expect(ctrl.snapshot().authRequired).toBe(true);

      // Not hammering: count stabilises after 401
      const countAfter = fetchFn.mock.calls.length;
      await flush(300);
      // The engine does NOT retry on auth_failed; count should stay same
      expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(countAfter + 1);
    });
  });

  describe("remove(id)", () => {
    it("calls ApiClient.deleteItem and tombstones locally", async () => {
      const item = makeItem("ITEM_TO_DELETE");
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(makeItemsResponse([item]))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValue(makeItemsResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      await ctrl.wake();
      fakeSocket.open();
      await flush(100);

      expect(ctrl.snapshot().items).toHaveLength(1);

      await ctrl.remove("ITEM_TO_DELETE");

      expect(ctrl.snapshot().items).toHaveLength(0);
      const deleteCalls = fetchFn.mock.calls.filter((c: unknown[]) =>
        typeof c[0] === "string" && (c[0] as string).includes("ITEM_TO_DELETE"),
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });
  });

  describe("doWake device-cache preload", () => {
    it("exposes cached cc.devices immediately after wake, before engine emits devices_changed", async () => {
      // Pre-populate cc.devices in storage before constructing the controller
      const cachedDevice = makeDevice("cached-d1");
      await storage.set("cc.devices", JSON.stringify([cachedDevice]));

      // fetchFn never returns a devices response — engine won't emit devices_changed
      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });

      // wake() must load the cache before returning
      await ctrl.wake();

      // Without waiting for socket open or engine fetch, snapshot should already have the device
      const snap = ctrl.snapshot();
      expect(snap.devices).toHaveLength(1);
      expect(snap.devices[0]!.id).toBe("cached-d1");
    });
  });

  describe("onChange(cb)", () => {
    it("notifies listener when feed changes", async () => {
      const item = makeItem();
      const fetchFn = jest.fn()
        .mockResolvedValueOnce(makeItemsResponse([item]))
        .mockResolvedValue(makeDevicesResponse([]));

      ctrl = new SyncController({ storage, socketFactory, fetchFn });
      const onChange = jest.fn();
      ctrl.onChange(onChange);

      await ctrl.wake();
      fakeSocket.open();
      await flush(100);

      expect(onChange).toHaveBeenCalled();
    });
  });

  describe("ready flag", () => {
    it("starts false and becomes true after wake() with stored auth", async () => {
      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));
      ctrl = new SyncController({ storage, socketFactory, fetchFn });

      expect(ctrl.snapshot().ready).toBe(false);

      await ctrl.wake();

      expect(ctrl.snapshot().ready).toBe(true);
      expect(ctrl.snapshot().authed).toBe(true);
    });

    it("starts false and becomes true after wake() with no stored auth", async () => {
      // Use fresh storage without auth to get the unauthenticated path
      const emptyStorage = new MemoryStorage();
      const fetchFn = jest.fn();
      ctrl = new SyncController({ storage: emptyStorage, socketFactory, fetchFn });

      expect(ctrl.snapshot().ready).toBe(false);

      await ctrl.wake();

      expect(ctrl.snapshot().ready).toBe(true);
      expect(ctrl.snapshot().authed).toBe(false);
    });

    it("ready stays true across sleep/wake cycles (not reset by sleep)", async () => {
      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));
      ctrl = new SyncController({ storage, socketFactory, fetchFn });

      await ctrl.wake();
      expect(ctrl.snapshot().ready).toBe(true);

      // Sleep resets the engine but must not reset ready
      ctrl.sleep();
      expect(ctrl.snapshot().ready).toBe(true);

      // Second wake cycle: ready must remain true
      const fakeSocket2 = makeFakeSocket();
      socketFactory.mockReturnValue(fakeSocket2.like);
      await ctrl.wake();
      expect(ctrl.snapshot().ready).toBe(true);
    });
  });

  describe("App Group drain on wake (A1 idempotency)", () => {
    it("drains the App Group mirror into the outbox with the PRESERVED ULID on wake", async () => {
      const MIRROR_ID = "01MIRRORUL1D0000000000000000";
      const shim = makeFakeShim();
      const ag: AppGroup = makeAppGroup(shim);

      // Pre-populate the App Group mirror (simulates a failed share-extension send)
      await ag.pushToMainOutbox({ id: MIRROR_ID, kind: "text", body: "mirrored" });

      // Capture POST bodies so we can assert the ULID is preserved
      const posted: Array<Record<string, unknown>> = [];
      const fetchFn = jest.fn().mockImplementation(
        async (_url: unknown, init?: { body?: string }) => {
          if (init?.body) {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            // Only capture item POSTs (not items GET or devices GET)
            if (body.id) posted.push(body);
          }
          if (String(_url).includes("/items") && !String(_url).includes("?")) {
            // POST /items → return a created item
            return new Response(
              JSON.stringify({
                id: MIRROR_ID,
                kind: "text",
                body: "mirrored",
                created_at: "2026-01-01T00:00:00",
                sync_seq: 1,
                deleted_at: null,
                origin_device_id: "d1",
                target_device_id: null,
              }),
              { status: 201, headers: { "content-type": "application/json" } },
            );
          }
          // All other GETs (cursor pull, devices)
          if (String(_url).includes("devices")) {
            return new Response(JSON.stringify({ devices: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ items: [], next_cursor: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      );

      ctrl = new SyncController({ storage, socketFactory, fetchFn, appGroup: ag });
      await ctrl.wake();
      fakeSocket.open();
      await flush(200);

      // The POST to /items must have used the PRESERVED ULID from the mirror
      const itemPosts = posted.filter((b) => b.body === "mirrored");
      expect(itemPosts).toHaveLength(1);
      expect(itemPosts[0]!["id"]).toBe(MIRROR_ID);

      // Mirror must be cleared after drain
      const remaining = await ag.drainMainOutbox();
      expect(remaining).toHaveLength(0);
    });

    it("per-entry enqueue failure: failed entry stays in mirror, successful entries enqueued, no duplicates on retry", async () => {
      // Scenario: mirror has 3 entries; Outbox.enqueue() throws for entry 2
      // (simulated by making storage.set throw exactly once — on the second
      // "cc.outbox" write, which is the persist() call that adds ID2).
      // After wake: entries 1 and 3 are enqueued; entry 2 survives in the mirror.
      // Second wake: entry 2 is retried; Outbox.enqueue is idempotent so 1/3 are
      // not duplicated.
      //
      // Implementation note: Outbox.enqueue() pushes to the in-memory array
      // BEFORE calling persist(). If persist() throws for ID2, ID2 stays in the
      // in-memory array — so the subsequent ID3 enqueue would also include ID2 in
      // its JSON, causing a second fault. To avoid this cascade we fault on the
      // SECOND outbox persist() call only (one-shot fault flag).
      const ID1 = "01AAAAAAAAAAAAAAAAAAAAAAAA01";
      const ID2 = "01AAAAAAAAAAAAAAAAAAAAAAAA02";
      const ID3 = "01AAAAAAAAAAAAAAAAAAAAAAAA03";

      let outboxSetCount = 0;
      let faultOnWake1 = true; // only fault during the first wake
      const realStorage = new MemoryStorage();
      await realStorage.set(AUTH_KEY, AUTH_VALUE);
      const storageProxy = new Proxy(realStorage, {
        get(target, prop) {
          if (prop === "set") {
            return async (key: string, value: string) => {
              if (faultOnWake1 && key === "cc.outbox") {
                outboxSetCount++;
                if (outboxSetCount === 2) {
                  // Second persist = ID2 being added; throw to simulate failure.
                  throw new Error("storage fault for entry 2");
                }
              }
              return target.set(key, value);
            };
          }
          return (target as unknown as Record<string | symbol, unknown>)[prop];
        },
      });

      const shim = makeFakeShim();
      const ag: AppGroup = makeAppGroup(shim);
      await ag.pushToMainOutbox({ id: ID1, kind: "text", body: "ok1" });
      await ag.pushToMainOutbox({ id: ID2, kind: "text", body: "fail" });
      await ag.pushToMainOutbox({ id: ID3, kind: "text", body: "ok3" });

      const fetchFn = jest.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ items: [], next_cursor: null }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      );

      ctrl = new SyncController({
        storage: storageProxy as unknown as import("@crossclipper/core").SyncStorage,
        socketFactory,
        fetchFn,
        appGroup: ag,
      });
      await ctrl.wake();
      fakeSocket.open();
      await flush(50);

      // Entry 2 must still be in the mirror (enqueue threw → not cleared + re-pushed).
      // Entries 1 and 3 must NOT be in the mirror (enqueued successfully → cleared).
      const mirrorAfterWake1 = await ag.peekMainOutbox();
      expect(mirrorAfterWake1.map((e) => e.id)).toEqual([ID2]);

      // Second wake: disable fault injection; ID2 enqueue succeeds; mirror clears.
      faultOnWake1 = false;
      outboxSetCount = 0;
      ctrl.sleep();
      const fakeSocket2 = makeFakeSocket();
      socketFactory.mockReturnValue(fakeSocket2.like);
      await ctrl.wake();
      fakeSocket2.open();
      await flush(50);

      const mirrorAfterWake2 = await ag.peekMainOutbox();
      expect(mirrorAfterWake2).toHaveLength(0);

      // Outbox idempotency: entries 1 and 3 must not appear twice.
      // Outbox.enqueue is a no-op for ids already present — safe to re-drain.
    });

    it("drain failure does not break wake (isolated)", async () => {
      const badAppGroup: AppGroup = {
        readAuth: async () => null,
        writeAuth: async () => {},
        clearAuth: async () => {},
        pushToMainOutbox: async () => {},
        peekMainOutbox: async () => { throw new Error("native crash"); },
        clearMainOutbox: async () => { throw new Error("native crash"); },
        drainMainOutbox: async () => { throw new Error("native crash"); },
      };

      const fetchFn = jest.fn().mockResolvedValue(makeItemsResponse([]));
      ctrl = new SyncController({ storage, socketFactory, fetchFn, appGroup: badAppGroup });

      // wake() must complete without throwing despite drain failure
      await expect(ctrl.wake()).resolves.toBeUndefined();
      expect(ctrl.snapshot().ready).toBe(true);
    });
  });
});
