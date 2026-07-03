import { describe, expect, it } from "vitest";

import { ApiClient } from "../src/api/client";
import { MemoryStorage } from "../src/storage";
import { SyncEngine, type SyncEngineEvent } from "../src/sync/engine";
import { FakeServer, sleep, tick } from "./helpers";

// Helper: count pull-related status events as a proxy for resync invocations
const syncingStatuses = (events: SyncEngineEvent[]) =>
  events.filter((e) => e.type === "status" && (e as { status: string }).status === "syncing").length;

function makeEngine(server: FakeServer, storage = new MemoryStorage()) {
  const engine = new SyncEngine({
    client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
    storage,
    socketFactory: server.socketFactory,
    wsUrl: () => "ws://test/api/v1/ws?token=t",
    backoff: { baseMs: 5, maxMs: 20, random: () => 1 },
    pingIntervalMs: 50,
  });
  const events: SyncEngineEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { engine, events, storage };
}

const bodies = (events: SyncEngineEvent[]) =>
  events.filter((e) => e.type === "item").map((e) => (e as { item: { body: string } }).item.body);

describe("SyncEngine scenarios", () => {
  it("cold start pulls all pages and persists the cursor", async () => {
    const server = new FakeServer();
    for (let n = 0; n < 5; n++) server.addItem(`item-${n}`);
    const last = server.items[server.items.length - 1]!;
    const { engine, events, storage } = makeEngine(server);

    await engine.start();
    await sleep(20);

    expect(bodies(events)).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
    // Cursor is an opaque sync_seq string (not item id); verify it equals the seq of the last item.
    expect(await storage.get("cc.cursor")).toBe(String(server.itemSyncSeq.get(last.id)));
    expect(events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status))
      .toEqual(["connecting", "syncing", "live"]);
    engine.stop();
  });

  it("live WS item_new events land in the cache", async () => {
    const server = new FakeServer();
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20); // reach live

    const item = server.addItem("pushed");
    server.broadcast({ type: "item_new", item });
    await tick();

    expect(bodies(events)).toEqual(["pushed"]);
    expect(engine.cache.has(item.id)).toBe(true);
    engine.stop();
  });

  it("recovers a cursor gap: items created while disconnected arrive via re-pull", async () => {
    const server = new FakeServer();
    server.addItem("before");
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20);

    server.lastSocket()!.serverDrop();          // connection lost
    server.addItem("missed-1");                 // server moves on without us
    server.addItem("missed-2");
    await sleep(30);                            // backoff (5ms) → reconnect → resync

    expect(bodies(events)).toEqual(["before", "missed-1", "missed-2"]);
    engine.stop();
  });

  it("dedups items delivered via both WS and pull", async () => {
    const server = new FakeServer();
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20);

    const item = server.addItem("dup");
    server.broadcast({ type: "item_new", item }); // live delivery
    await tick();
    server.lastSocket()!.serverDrop();            // reconnect → re-pull includes "dup"
    await sleep(30);

    expect(bodies(events)).toEqual(["dup"]);      // emitted exactly once
    engine.stop();
  });

  it("WS events received during a pull are buffered and applied after", async () => {
    const server = new FakeServer();
    server.listDelayMs = 20;
    server.addItem("pulled");
    const { engine, events } = makeEngine(server);
    await engine.start();
    await tick(); // socket open, pull in flight (delayed)

    const live = server.addItem("live-during-pull");
    server.broadcast({ type: "item_new", item: live });
    await sleep(40);

    expect(bodies(events)).toEqual(["pulled", "live-during-pull"]);
    engine.stop();
  });

  it("item_deleted removes from cache; devices_changed is surfaced", async () => {
    const server = new FakeServer();
    const item = server.addItem("gone");
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20);

    server.broadcast({ type: "item_deleted", item_id: item.id });
    server.broadcast({ type: "device_changed" });
    await tick();

    expect(engine.cache.has(item.id)).toBe(false);
    expect(events.some((e) => e.type === "item_deleted")).toBe(true);
    expect(events.some((e) => e.type === "devices_changed")).toBe(true);
    engine.stop();
  });

  it("pulled tombstones delete from cache", async () => {
    const server = new FakeServer();
    const keep = server.addItem("keep");
    const victim = server.addItem("victim");
    const { engine, events, storage } = makeEngine(server);
    await engine.start();
    await sleep(20);

    server.lastSocket()!.serverDrop();
    server.deleteItem(victim.id);              // tombstoned while offline
    await sleep(30);

    expect(engine.cache.has(keep.id)).toBe(true);
    expect(engine.cache.has(victim.id)).toBe(false);
    expect(events.some((e) => e.type === "item_deleted"
      && (e as { itemId: string }).itemId === victim.id)).toBe(true);
    engine.stop();
  });

  it("sends keepalive pings while live", async () => {
    const server = new FakeServer();
    const { engine } = makeEngine(server);    // pingIntervalMs: 50
    await engine.start();
    await sleep(120);
    const pings = server.lastSocket()!.sent.filter((s) => s === '{"type":"ping"}');
    expect(pings.length).toBeGreaterThanOrEqual(2);
    engine.stop();
  });

  // Finding 1: no resync re-entry guard — second onOpen mid-pull must not start a concurrent resync;
  // it must queue exactly one follow-up that runs after the first finishes.
  it("concurrent resync on flap: no concurrent pull starts during in-flight resync", async () => {
    const server = new FakeServer();
    server.listDelayMs = 40; // slow pull so we can flap mid-pull
    server.addItem("item-a");
    server.addItem("item-b");
    const { engine, events, storage } = makeEngine(server);

    // Start engine — socket opens (autoOpen), first resync starts (pull delayed 40ms).
    // FakeServer increments listCallCount AFTER the delay, so it is 0 while the pull is in-flight.
    await engine.start();
    await tick(); // onOpen fired; first resync in-flight (listCallCount still 0)

    // Simulate connection flap mid-pull.
    server.lastSocket()!.serverDrop();
    await tick();
    await tick();

    // Core invariant: the second onOpen must NOT have started a second pull concurrently.
    // listCallCount is still 0 because the first pull's 40ms delay hasn't elapsed, and the
    // guarded resync must not have started a new pull on top of the in-flight one.
    expect(server.listCallCount).toBe(0);

    // Let everything settle — first pull finishes, queued follow-up runs.
    await sleep(120);

    // Items arrive exactly once regardless of how many resyncs ran total.
    expect(bodies(events)).toEqual(["item-a", "item-b"]);

    // Cursor persisted correctly to the final item's sync_seq.
    const expectedCursor = String(server.itemSyncSeq.get(server.items[server.items.length - 1]!.id));
    expect(await storage.get("cc.cursor")).toBe(expectedCursor);

    engine.stop();
  });

  // Finding 2: 401 retries forever
  it("401 during pull emits auth_failed exactly once, stops engine, no further retries", async () => {
    const server = new FakeServer();
    server.rejectListWith = { status: 401, code: "unauthorized" };
    const { engine, events } = makeEngine(server);

    await engine.start();
    await sleep(50); // enough time for multiple retries if bug is present

    const authFailedEvents = events.filter((e) => e.type === "auth_failed");
    expect(authFailedEvents).toHaveLength(1);

    const statusEvents = events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status);
    expect(statusEvents[statusEvents.length - 1]).toBe("stopped");

    // Advance time further — no more pulls should occur
    const pullCountBefore = server.listCallCount;
    await sleep(50);
    expect(server.listCallCount).toBe(pullCountBefore); // no further pulls
  });

  // Finding 3: multi-page cursor persistence
  it("multi-page pull: walks all pages, cache complete, cursor = final page cursor", async () => {
    const server = new FakeServer();
    server.listPageLimit = 3; // force pagination at 3 items per page
    for (let n = 0; n < 7; n++) server.addItem(`pg-item-${n}`);
    const last = server.items[server.items.length - 1]!;
    const { engine, events, storage } = makeEngine(server);

    await engine.start();
    await sleep(50);

    // All 7 items delivered exactly once
    expect(bodies(events)).toEqual(
      ["pg-item-0", "pg-item-1", "pg-item-2", "pg-item-3", "pg-item-4", "pg-item-5", "pg-item-6"],
    );
    // All in cache
    for (const item of server.items) {
      expect(engine.cache.has(item.id)).toBe(true);
    }
    // Cursor = final page's next_cursor = sync_seq of last item
    expect(await storage.get("cc.cursor")).toBe(String(server.itemSyncSeq.get(last.id)));

    engine.stop();
  });

  // Finding 4: buffer-boundary tombstone scenario
  it("WS item_deleted for item delivered by in-flight pull results in deleted item, one event", async () => {
    const server = new FakeServer();
    server.listDelayMs = 20;
    const victim = server.addItem("doomed");
    const { engine, events } = makeEngine(server);

    await engine.start();
    await tick(); // pull in flight (delayed)

    // WS tombstone arrives for the item the pull is about to deliver
    server.broadcast({ type: "item_deleted", item_id: victim.id });
    await sleep(50); // pull completes, buffer drains

    // Item must NOT be in cache (tombstone wins)
    expect(engine.cache.has(victim.id)).toBe(false);

    // Exactly one item_deleted event (not zero, not two)
    const deletedEvents = events.filter(
      (e) => e.type === "item_deleted" && (e as { itemId: string }).itemId === victim.id,
    );
    expect(deletedEvents).toHaveLength(1);

    // No "item" event for victim (pull upserted then tombstone removed, or tombstone suppressed upsert)
    const itemEvents = events.filter(
      (e) => e.type === "item" && (e as { item: { id: string } }).item.id === victim.id,
    );
    expect(itemEvents).toHaveLength(0);

    engine.stop();
  });

  // Item 2 fix: stop() racing an in-flight resync must not emit status:live or start pings.
  it("stop() during in-flight pull: no live status emitted, no pings sent", async () => {
    const server = new FakeServer();
    // Make the list call hang until we manually resolve it.
    let resolveList!: () => void;
    const listHeld = new Promise<void>((res) => { resolveList = res; });
    server.listDelayMs = 0;
    // Override fetchFn to hold the first GET /items indefinitely.
    const origFetch = server.fetchFn;
    let listHeld_ = false;
    server.fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/items" && (init?.method ?? "GET") === "GET" && !listHeld_) {
        listHeld_ = true;
        await listHeld;
      }
      return origFetch(input as RequestInfo, init);
    }) as typeof fetch;

    const { engine, events } = makeEngine(server);
    await engine.start();
    await tick(); // socket opens, resync starts, pull is now blocked

    // Call stop() while the pull is in-flight.
    engine.stop();

    // Resolve the blocked pull.
    resolveList();
    await sleep(20);

    // Must NOT have emitted status:live after stop().
    const statusesAfterStop = events
      .map((e) => (e as { status?: string }).status)
      .filter((s): s is string => s !== undefined);
    // The last status must be "stopped", not "live".
    expect(statusesAfterStop[statusesAfterStop.length - 1]).toBe("stopped");
    expect(statusesAfterStop).not.toContain("live");

    // No pings must have been sent (ping timer must not have started).
    const pings = server.sockets.flatMap((s) => s.sent).filter((s) => s === '{"type":"ping"}');
    expect(pings).toHaveLength(0);
  });
});
