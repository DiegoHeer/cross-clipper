import type { Item } from "./types";

export class ItemCache {
  private readonly items = new Map<string, Item>();
  private readonly tombstones = new Set<string>();

  upsert(item: Item): boolean {
    if (this.tombstones.has(item.id)) return false; // deletion wins
    if (this.items.has(item.id)) return false;      // items are immutable in v1
    this.items.set(item.id, item);
    return true;
  }

  remove(id: string): boolean {
    if (this.tombstones.has(id)) return false;
    this.tombstones.add(id);
    this.items.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  list(filter?: { origin?: string }): Item[] {
    const all = [...this.items.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    return filter?.origin ? all.filter((i) => i.origin_device_id === filter.origin) : all;
  }
}
