import { describe, expect, it } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import { FeedStore, MAX_ITEMS } from "../src/background/feedStore";

const item = (id: string): Item =>
  ({
    id,
    kind: "text",
    body: id,
    origin_device_id: "d",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
  }) as Item;

describe("FeedStore", () => {
  it("dedups by id and lists newest-first", async () => {
    const store = new FeedStore(new MemoryStorage());
    await store.init();
    expect(await store.upsert(item("01A"))).toBe(true);
    expect(await store.upsert(item("01C"))).toBe(true);
    expect(await store.upsert(item("01B"))).toBe(true);
    expect(await store.upsert(item("01B"))).toBe(false);
    expect(store.list().map((i) => i.id)).toEqual(["01C", "01B", "01A"]);
  });

  it("survives a restart via storage (the popup-instant-render path)", async () => {
    const storage = new MemoryStorage();
    const a = new FeedStore(storage);
    await a.init();
    await a.upsert(item("01A"));
    const b = new FeedStore(storage);
    await b.init();
    expect(b.list().map((i) => i.id)).toEqual(["01A"]);
  });

  it("tombstone wins: removed ids cannot be re-upserted (late WS echo)", async () => {
    const store = new FeedStore(new MemoryStorage());
    await store.init();
    await store.upsert(item("01A"));
    expect(await store.remove("01A")).toBe(true);
    expect(await store.remove("01A")).toBe(false);
    expect(await store.upsert(item("01A"))).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("caps at MAX_ITEMS, dropping the oldest", async () => {
    const store = new FeedStore(new MemoryStorage());
    await store.init();
    for (let i = 0; i < MAX_ITEMS + 5; i++) {
      await store.upsert(item(`01${String(i).padStart(6, "0")}`));
    }
    expect(store.list()).toHaveLength(MAX_ITEMS);
    expect(store.list().at(-1)!.id).toBe("01000005");
  });
});
