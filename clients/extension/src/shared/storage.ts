import browser from "webextension-polyfill";
import type { SyncStorage } from "@crossclipper/core";

type Area = {
  get(k: string | string[]): Promise<Record<string, unknown>>;
  set(v: Record<string, unknown>): Promise<void>;
  remove(k: string | string[]): Promise<void>;
};

/** browser.storage.local as core's SyncStorage — the worker's persistence
 *  for cursor (cc.cursor), outbox (cc.outbox) and the feed store (cc.items). */
export class ExtensionStorage implements SyncStorage {
  constructor(private readonly area: Area = browser.storage.local as unknown as Area) {}

  async get(key: string): Promise<string | null> {
    const res = await this.area.get(key);
    const v = res[key];
    return typeof v === "string" ? v : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.area.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }
}
