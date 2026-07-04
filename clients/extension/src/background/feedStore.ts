import type { Item, SyncStorage } from "@crossclipper/core";

const ITEMS_KEY = "cc.items";
const TOMBSTONES_KEY = "cc.itemTombstones";
export const MAX_ITEMS = 1000;

/** Extension-side persisted feed. Core's ItemCache is in-memory and cursor
 *  pulls only return NEW items after a worker restart — this store is what
 *  makes the popup render instantly from cache (extension spec §6).
 *  Persistence glue only: live dedup/ordering authority stays in core. */
export class FeedStore {
  private items: Item[] = []; // newest-first (ULID desc)
  private tombstones = new Set<string>();

  constructor(private readonly storage: SyncStorage) {}

  async init(): Promise<void> {
    try {
      this.items = JSON.parse((await this.storage.get(ITEMS_KEY)) ?? "[]") as Item[];
      this.tombstones = new Set(
        JSON.parse((await this.storage.get(TOMBSTONES_KEY)) ?? "[]") as string[],
      );
    } catch {
      this.items = [];
      this.tombstones = new Set();
    }
  }

  async upsert(item: Item): Promise<boolean> {
    if (this.tombstones.has(item.id)) return false;
    if (this.items.some((i) => i.id === item.id)) return false;
    this.items.push(item);
    this.items.sort((a, b) => (a.id > b.id ? -1 : 1));
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    await this.persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (this.tombstones.has(id)) return false;
    this.tombstones.add(id);
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    return true;
  }

  list(): Item[] {
    return [...this.items];
  }

  async clear(): Promise<void> {
    this.items = [];
    this.tombstones = new Set();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.storage.set(ITEMS_KEY, JSON.stringify(this.items));
    await this.storage.set(TOMBSTONES_KEY, JSON.stringify([...this.tombstones]));
  }
}
