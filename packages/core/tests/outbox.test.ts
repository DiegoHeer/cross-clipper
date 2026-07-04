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

  // ---------------------------------------------------------------------------
  // cancel() tests
  // ---------------------------------------------------------------------------

  it("cancel removes a queued entry before it sends and persists the removal", async () => {
    const server = new FakeServer();
    server.failNextCreates = 100; // fully offline
    const storage = new MemoryStorage();
    const { outbox } = makeOutbox(server, storage);
    await outbox.load();
    // Stop so the auto-flush on send() is a no-op — entry stays at attempts=0
    outbox.stop();

    const id = await outbox.send("text", "cancel-me");
    // Entry must be in pending before cancel
    expect(outbox.pending().map((e) => e.id)).toContain(id);

    const cancelled = await outbox.cancel(id);
    expect(cancelled).toBe(true);
    expect(outbox.pending().map((e) => e.id)).not.toContain(id);

    // Persisted JSON must also not contain the entry
    const raw = await storage.get("cc.outbox");
    const persisted = JSON.parse(raw ?? "[]") as Array<{ id: string }>;
    expect(persisted.map((e) => e.id)).not.toContain(id);

    // After server recovers and a fresh outbox loads + flushes, NO createItem for that id
    server.failNextCreates = 0;
    const { outbox: outbox2 } = makeOutbox(server, storage);
    await outbox2.load();
    await outbox2.flush();
    await sleep(20);
    expect(server.postAttempts).toBe(0); // never sent
    expect(server.items).toHaveLength(0);
  });

  it("cancel returns false for an unknown id", async () => {
    const server = new FakeServer();
    const { outbox } = makeOutbox(server);
    await outbox.load();
    const cancelled = await outbox.cancel("01UNKNOWNID0000000000000000");
    expect(cancelled).toBe(false);
  });

  it("cancel returns false while a send is in-flight and the send completes normally", async () => {
    // Use a slow server so we can call cancel while flush is executing
    let resolveCreate!: (item: unknown) => void;
    const createPromise = new Promise<unknown>((r) => {
      resolveCreate = r;
    });
    const capturedId: { value: string } = { value: "" };
    const client = {
      createItem: async (input: Record<string, unknown>) => {
        capturedId.value = input["id"] as string;
        // Block until test resolves
        return createPromise;
      },
    } as unknown as ApiClient;
    const storage = new MemoryStorage();
    const events: OutboxEvent[] = [];
    const outbox = new Outbox({
      client,
      storage,
      onEvent: (e) => events.push(e),
    });
    await outbox.load();

    // Start a send — flush begins immediately (async), createItem blocks
    const sendPromise = outbox.send("text", "in-flight");
    // Yield to let flush enter createItem
    await new Promise((r) => setTimeout(r, 0));

    const outboxId = await sendPromise;
    // Flush is inside createItem now (flushing=true)
    const cancelled = await outbox.cancel(outboxId);
    expect(cancelled).toBe(false);

    // Unblock the in-flight send — it must complete normally
    resolveCreate({
      id: outboxId,
      kind: "text",
      body: "in-flight",
      origin_device_id: "cli",
      target_device_id: null,
      blob_id: null,
      created_at: "2026-07-03T00:00:00",
      deleted_at: null,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(events.some((e) => e.type === "delivered")).toBe(true);
    expect(outbox.pending()).toHaveLength(0);
  });

  it("cancel returns false for entries[0] that has already been attempted (retry gap)", async () => {
    const server = new FakeServer();
    server.failNextCreates = 100; // fully offline — stays in retry loop
    const storage = new MemoryStorage();
    const { outbox } = makeOutbox(server, storage);
    await outbox.load();

    const id = await outbox.send("text", "retry-me");
    // Wait for first attempt to fail — outbox is now in retry gap (flushing=false, attempts>=1)
    await sleep(10);

    // Entry is still pending but was already POSTed once — cancel must refuse
    expect(outbox.pending().map((e) => e.id)).toContain(id);
    const pending = outbox.pending();
    // Verify the entry has been attempted (attempts > 0) before testing cancel
    expect(pending[0]?.attempts).toBeGreaterThan(0);
    const cancelled = await outbox.cancel(id);
    expect(cancelled).toBe(false);

    outbox.stop();
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
