import { describe, expect, it } from "vitest";

import type { Item, ItemsPage } from "../src/types";

describe("generated contract types", () => {
  it("Item shape matches the wire contract", () => {
    const item: Item = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      kind: "text",
      body: "hello",
      origin_device_id: "dev1",
      target_device_id: null,
      blob_id: null,
      created_at: "2026-07-03T10:00:00",
      deleted_at: null,
    };
    const page: ItemsPage = { items: [item], next_cursor: null };
    expect(page.items[0]?.id).toBe(item.id);
  });
});
