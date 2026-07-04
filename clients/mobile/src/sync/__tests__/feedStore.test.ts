/**
 * FeedStore tests — TDD step 1 (failing).
 * Mirrors the extension's feedStore semantics exactly (extension spec §6, plan A2).
 */
import { MemoryStorage } from "@crossclipper/core";
import { FeedStore, MAX_ITEMS } from "../feedStore";
import type { Item } from "@crossclipper/core";

function makeItem(id: string): Item {
  return {
    id,
    kind: "text",
    body: `body-${id}`,
    user_id: "u1",
    origin_device_id: "d1",
    target_device_id: null,
    created_at: "2026-01-01T00:00:00",
    deleted_at: null,
    sync_seq: 1,
  } as unknown as Item;
}

describe("FeedStore", () => {
  let storage: MemoryStorage;
  let store: FeedStore;

  beforeEach(async () => {
    storage = new MemoryStorage();
    store = new FeedStore(storage);
    await store.init();
  });

  describe("upsert", () => {
    it("adds an item and makes it available via list()", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      await store.upsert(item);
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0]!.id).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    });

    it("deduplicates by id — second upsert of same id is a no-op", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      await store.upsert(item);
      await store.upsert(item);
      expect(store.list()).toHaveLength(1);
    });

    it("returns true on new insert, false on duplicate", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      expect(await store.upsert(item)).toBe(true);
      expect(await store.upsert(item)).toBe(false);
    });

    it("orders items newest-first (ULID descending)", async () => {
      // ULIDs are lexicographically sortable by time
      const older = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      const newer = makeItem("01BX5ZZKBKACTAV9WEVGEMMVS0");
      await store.upsert(older);
      await store.upsert(newer);
      const list = store.list();
      expect(list[0]!.id).toBe("01BX5ZZKBKACTAV9WEVGEMMVS0");
      expect(list[1]!.id).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    });

    it("caps at MAX_ITEMS (1000) — drops oldest when over limit", async () => {
      // Insert MAX_ITEMS + 1 items with ascending ULIDs
      for (let i = 0; i <= MAX_ITEMS; i++) {
        const id = i.toString().padStart(26, "0");
        await store.upsert(makeItem(id));
      }
      expect(store.list()).toHaveLength(MAX_ITEMS);
      // The oldest (id "00...0") should be dropped; newest kept
      const ids = store.list().map((it) => it.id);
      expect(ids).not.toContain("0".repeat(26));
    });

    it("persists cc.items to storage on upsert", async () => {
      await store.upsert(makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV"));
      const raw = await storage.get("cc.items");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as Item[];
      expect(parsed).toHaveLength(1);
    });
  });

  describe("remove (tombstone)", () => {
    it("removes an item from the list", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      await store.upsert(item);
      await store.remove("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      expect(store.list()).toHaveLength(0);
    });

    it("records a tombstone so re-upsert of same id is silently dropped", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      await store.upsert(item);
      await store.remove("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      // Simulates a cursor re-pull delivering the same item
      const result = await store.upsert(item);
      expect(result).toBe(false);
      expect(store.list()).toHaveLength(0);
    });

    it("returns true on first remove, false on subsequent", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      await store.upsert(item);
      expect(await store.remove("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
      expect(await store.remove("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false);
    });

    it("persists cc.itemTombstones to storage", async () => {
      await store.remove("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      const raw = await storage.get("cc.itemTombstones");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as string[];
      expect(parsed).toContain("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    });

    it("can tombstone an id that was never upserted (pre-emptive tombstone)", async () => {
      await store.remove("NEVER_INSERTED");
      const result = await store.upsert(makeItem("NEVER_INSERTED"));
      expect(result).toBe(false);
    });
  });

  describe("init (persistence round-trip)", () => {
    it("restores items and tombstones from storage", async () => {
      const item = makeItem("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      await store.upsert(item);
      await store.remove("01BX5ZZKBKACTAV9WEVGEMMVS0");

      // Create a new store instance over the same storage
      const store2 = new FeedStore(storage);
      await store2.init();

      expect(store2.list()).toHaveLength(1);
      // Tombstone survives — upsert of that id is dropped
      expect(await store2.upsert(makeItem("01BX5ZZKBKACTAV9WEVGEMMVS0"))).toBe(false);
    });

    it("survives corrupt storage gracefully", async () => {
      await storage.set("cc.items", "not-json");
      await storage.set("cc.itemTombstones", "bad");
      const store2 = new FeedStore(storage);
      await store2.init();
      expect(store2.list()).toHaveLength(0);
    });
  });
});
