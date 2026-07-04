import { describe, expect, it } from "vitest";

import { ApiClient } from "../src/api/client";
import { Outbox, type OutboxEvent, type OutboxEntry } from "../src/outbox";
import { MemoryStorage } from "../src/storage";
import type { Item } from "../src/types";
import { FakeServer, sleep } from "./helpers";

function makeOutbox(server: FakeServer, storage = new MemoryStorage()) {
  const events: OutboxEvent[] = [];
  const outbox = new Outbox({
    client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
    storage,
    onEvent: (e) => events.push(e),
    baseMs: 5,
    maxMs: 20,
  });
  return { outbox, events, storage };
}

describe("Outbox", () => {
  it("delivers immediately when online", async () => {
    const server = new FakeServer();
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    const id = await outbox.send("text", "hello");
    await sleep(20);

    expect(server.items.map((i) => i.id)).toEqual([id]);
    expect(events).toEqual([{ type: "delivered", item: server.items[0] }]);
    expect(outbox.pending()).toEqual([]);
  });

  it("retries network failures with backoff, reusing the same ULID", async () => {
    const server = new FakeServer();
    server.failNextCreates = 2;
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    const id = await outbox.send("text", "flaky");
    await sleep(80); // 2 failures (5ms, 10ms backoff) then success

    expect(server.postAttempts).toBe(3);
    expect(server.items.map((i) => i.id)).toEqual([id]); // delivered exactly once
    expect(events.at(-1)).toEqual({ type: "delivered", item: server.items[0] });
    expect(outbox.pending()).toEqual([]);
    outbox.stop();
  });

  it("drops entry and emits rejected on 4xx (non-401)", async () => {
    const server = new FakeServer();
    server.rejectNextCreateWith = { status: 422, code: "validation_error" };
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    await outbox.send("text", "bad");
    await sleep(20);

    expect(server.items).toEqual([]);
    expect(events[0]?.type).toBe("rejected");
    expect(outbox.pending()).toEqual([]);
    expect(server.postAttempts).toBe(1); // no retry loop
  });

  it("keeps the entry and halts on 401", async () => {
    const server = new FakeServer();
    server.rejectNextCreateWith = { status: 401, code: "invalid_token" };
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    await outbox.send("text", "queued");
    await sleep(30);

    expect(events).toContainEqual({ type: "auth_required" });
    expect(outbox.pending()).toHaveLength(1); // survives for after re-auth
    expect(server.postAttempts).toBe(1);      // exactly one attempt, no hammering
  });

  it("persists queue across restarts and delivers FIFO", async () => {
    const server = new FakeServer();
    server.failNextCreates = 100; // fully offline
    const storage = new MemoryStorage();
    const first = makeOutbox(server, storage);
    await first.outbox.load();
    await first.outbox.send("text", "one");
    await first.outbox.send("text", "two");
    first.outbox.stop();

    server.failNextCreates = 0; // back online; simulate app restart
    const second = makeOutbox(server, storage);
    await second.outbox.load();
    expect(second.outbox.pending()).toHaveLength(2);
    await second.outbox.flush();
    await sleep(20);

    expect(server.items.map((i) => i.body)).toEqual(["one", "two"]);
    expect(second.outbox.pending()).toEqual([]);
  });

  it("carries the notification target through to createItem and persists it", async () => {
    const created: Array<Record<string, unknown>> = [];
    const client = {
      createItem: async (input: Record<string, unknown>) => {
        created.push(input);
        return { id: input["id"], kind: input["kind"], body: input["body"] } as Item;
      },
    } as unknown as ApiClient;
    const storage = new MemoryStorage();
    const outbox = new Outbox({ client, storage, ulidFn: () => "01TARGETULID000000000000000" });
    await outbox.load();
    await outbox.send("text", "ping", "device-b");
    await outbox.flush();
    expect(created[0]).toMatchObject({ body: "ping", target_device_id: "device-b" });

    // untargeted sends omit the field entirely
    await outbox.send("text", "silent one");
    await outbox.flush();
    expect("target_device_id" in created[1]!).toBe(false);
  });

  it("halts on 401, accepts sends while halted, and resumes after re-auth", async () => {
    const server = new FakeServer();
    // Reject the first two creates with 401 to keep both items in queue
    server.rejectNextCreateWith = { status: 401, code: "invalid_token" };
    const storage = new MemoryStorage();
    const { outbox, events } = makeOutbox(server, storage);
    await outbox.load();

    // Send item A → 401 halts, auth_required signals, A stays in queue
    await outbox.send("text", "itemA");
    await sleep(30);
    expect(events).toContainEqual({ type: "auth_required" });
    expect(outbox.pending()).toHaveLength(1);

    // Set up rejection for the next create attempt (from send B's flush)
    server.rejectNextCreateWith = { status: 401, code: "invalid_token" };

    // Send item B → flush attempts itemA, gets 401 again, B joins queue
    await outbox.send("text", "itemB");
    await sleep(30);
    expect(outbox.pending()).toHaveLength(2);

    // Fix the token and flush → both delivered in order
    await outbox.flush();
    await sleep(30);

    expect(server.items.map((i) => i.body)).toEqual(["itemA", "itemB"]);
    expect(outbox.pending()).toEqual([]);
  });
});
