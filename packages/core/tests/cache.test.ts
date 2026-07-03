import { describe, expect, it } from "vitest";

import { ItemCache } from "../src/cache";
import type { Item } from "../src/types";

const item = (id: string, origin = "dev1"): Item => ({
  id, kind: "text", body: `body-${id}`, origin_device_id: origin,
  blob_id: null, created_at: "2026-07-03T10:00:00", deleted_at: null,
  target_device_id: null,
});

describe("ItemCache", () => {
  it("dedups upserts by id", () => {
    const cache = new ItemCache();
    expect(cache.upsert(item("01B"))).toBe(true);
    expect(cache.upsert(item("01B"))).toBe(false); // duplicate delivery (WS + pull)
    expect(cache.list()).toHaveLength(1);
  });

  it("lists ascending by id with origin filter", () => {
    const cache = new ItemCache();
    cache.upsert(item("01C", "a"));
    cache.upsert(item("01B", "b"));
    expect(cache.list().map((i) => i.id)).toEqual(["01B", "01C"]);
    expect(cache.list({ origin: "a" }).map((i) => i.id)).toEqual(["01C"]);
  });

  it("remove is once-only and tombstone wins over late upsert", () => {
    const cache = new ItemCache();
    cache.upsert(item("01B"));
    expect(cache.remove("01B")).toBe(true);
    expect(cache.remove("01B")).toBe(false);        // repeated delete event
    expect(cache.upsert(item("01B"))).toBe(false);  // stale item_new after delete
    expect(cache.list()).toHaveLength(0);
  });

  it("remove of an unknown id still records the tombstone once", () => {
    const cache = new ItemCache();
    expect(cache.remove("01Z")).toBe(true);
    expect(cache.remove("01Z")).toBe(false);
  });
});
