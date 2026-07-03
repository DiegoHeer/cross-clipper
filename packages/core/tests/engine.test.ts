import { describe, expect, it } from "vitest";

import { ApiClient } from "../src/api/client";
import { MemoryStorage } from "../src/storage";
import { SyncEngine, type SyncEngineEvent } from "../src/sync/engine";
import { FakeServer, sleep, tick } from "./helpers";

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
});
