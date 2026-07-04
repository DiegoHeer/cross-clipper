import { afterEach, describe, expect, it, vi } from "vitest";

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

  // Pull-retry backoff growth.
  // Uses real timers with tight delays (same idiom as other SyncEngine tests).
  // random: () => 1 → jitter factor = 0.5 + 1*0.5 = 1.0, so delay = min(max, base*2^n) exactly.
  describe("pull-retry exponential backoff", () => {
    it("delay grows exponentially capped at maxMs on repeated pull failures", async () => {
      const server = new FakeServer();
      server.alwaysRejectListWith = { status: 503, code: "unavailable" };
      // base=4ms, max=20ms, random=()=>1 → delays: 4, 8, 16, 20(cap), …
      // Cumulative fire times: attempt0≈0, attempt1≈4, attempt2≈12, attempt3≈28, attempt4≈48.
      const engine = new SyncEngine({
        client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
        storage: new MemoryStorage(),
        socketFactory: server.socketFactory,
        wsUrl: () => "ws://test/api/v1/ws?token=t",
        backoff: { baseMs: 4, maxMs: 20, random: () => 1 },
        pingIntervalMs: 500,
      });
      engine.onEvent(() => {});

      await engine.start();
      // attempt 0 fires at t≈0 (WS open → resync). Delay after failure = 4ms.
      await sleep(2);
      expect(server.listAttempts).toBe(1); // attempt 0 done
      // attempt 1 fires at t≈4ms. Delay = 8ms.
      await sleep(4);
      expect(server.listAttempts).toBe(2); // attempt 1 done (at 6ms total, just past 4ms mark)
      // attempt 2 fires at t≈12ms. Delay = 16ms.
      await sleep(8);
      expect(server.listAttempts).toBe(3); // attempt 2 done (at 14ms total, just past 12ms mark)
      // attempt 3 fires at t≈28ms. Delay = min(20, 32) = 20ms (capped).
      await sleep(16);
      expect(server.listAttempts).toBe(4); // attempt 3 done (at 30ms total, just past 28ms mark)
      // attempt 4 fires at t≈48ms.
      await sleep(20);
      expect(server.listAttempts).toBe(5); // attempt 4 done (at 50ms total)

      engine.stop();
    });

    it("backoff resets to base after a successful pull", async () => {
      const server = new FakeServer();
      server.alwaysRejectListWith = { status: 503, code: "unavailable" };
      // base=5ms, max=40ms, random=()=>1 → delays: 5, 10, 20, 40(cap).
      const engine = new SyncEngine({
        client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
        storage: new MemoryStorage(),
        socketFactory: server.socketFactory,
        wsUrl: () => "ws://test/api/v1/ws?token=t",
        backoff: { baseMs: 5, maxMs: 40, random: () => 1 },
        pingIntervalMs: 500,
      });
      engine.onEvent(() => {});

      await engine.start();
      // Three failures: delays 5, 10, 20ms → attempt 3 fires at accumulated ≈35ms.
      await sleep(4);  expect(server.listAttempts).toBe(1); // attempt 0 done
      await sleep(6);  expect(server.listAttempts).toBe(2); // attempt 1 at +5ms
      await sleep(12); expect(server.listAttempts).toBe(3); // attempt 2 at +10ms

      // Let the server succeed on attempt 3 (fires after 20ms from attempt 2).
      server.alwaysRejectListWith = null;
      await sleep(22); expect(server.listAttempts).toBe(4); // attempt 3 succeeds
      expect(server.listCallCount).toBe(1); // exactly one success

      // After success, pullAttempt is reset to 0.
      // Next failure sequence must restart at delay=5ms (not carry 40ms from before).
      server.alwaysRejectListWith = { status: 503, code: "unavailable" };
      const attemptsBeforeReset = server.listAttempts;

      // WS drop → socket reconnects and triggers a new resync pull.
      // The reconnect itself has backoff ≈5ms. After reconnect + pull failure, retry delay must be 5ms.
      server.lastSocket()!.serverDrop();
      await sleep(20); // covers socket reconnect (≈5ms) + pull + first retry delay (5ms)
      const attemptsAfterFirstCycle = server.listAttempts;
      expect(attemptsAfterFirstCycle).toBeGreaterThan(attemptsBeforeReset + 1); // at least 2 new attempts

      engine.stop();
    });

    it("a WS reconnect (onOpen) clears the pending pull retry timer before it fires", async () => {
      // Scenario: pull fails → retry timer armed for 50ms.
      // BEFORE that 50ms elapses, the WS reconnects (onOpen fires, calls resync()).
      // resync() clears retryTimer immediately. The 50ms timer must never fire.
      // Without the clearTimeout fix, the 50ms timer fires a second pull at +50ms.
      //
      // Implementation: use autoOpen=false so we control when serverOpen fires.
      // After pull 0 fails, we manually fire serverOpen on the new socket before the retry fires.
      const server = new FakeServer();
      server.autoOpen = false; // manual control over socket open timing
      server.alwaysRejectListWith = { status: 503, code: "unavailable" };

      const engine = new SyncEngine({
        client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
        storage: new MemoryStorage(),
        socketFactory: server.socketFactory,
        wsUrl: () => "ws://test/api/v1/ws?token=t",
        backoff: { baseMs: 50, maxMs: 200, random: () => 1 },
        pingIntervalMs: 500,
      });
      engine.onEvent(() => {});

      await engine.start();
      // Manually open socket → triggers resync() → pull 0 fails → retry timer armed for 50ms.
      server.lastSocket()!.serverOpen();
      await sleep(5); // pull 0 completes (fails); retry timer armed at t+50ms

      expect(server.listAttempts).toBe(1);

      // Simulate a "WS nudge / reconnect" by opening the socket NOW (well before the 50ms timer).
      // This is what happens when the push notification wakes the client or a new WS connection opens.
      server.lastSocket()!.serverOpen(); // fires onOpen → resync() → clearTimeout(retryTimer)
      await sleep(5); // pull 1 fires immediately (from wake), fails

      expect(server.listAttempts).toBe(2); // pull 1 fired from wake, not from the 50ms timer

      // The OLD 50ms retry timer must have been cleared by resync(). A NEW 50ms timer was set
      // after pull 1 failed, but we don't advance that far. Verify nothing fires in next 40ms
      // (which is within the OLD timer's remaining window of ~45ms, but before the new one).
      await sleep(40);
      expect(server.listAttempts).toBe(2); // no duplicate from cancelled original timer

      engine.stop();
    });
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
