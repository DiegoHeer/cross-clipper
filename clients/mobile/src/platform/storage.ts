import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SyncStorage } from "@crossclipper/core";

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * Adapts @react-native-async-storage/async-storage to core's SyncStorage
 * interface. Adds remove() beyond the interface minimum (mirrors ExtensionStorage).
 *
 * The storage instance is injectable for testing; defaults to the real
 * AsyncStorage so callers can use `new AsyncStorageAdapter()` without args.
 */
export class AsyncStorageAdapter implements SyncStorage {
  constructor(
    private readonly storage: AsyncStorageLike = AsyncStorage as AsyncStorageLike,
  ) {}

  async get(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.storage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.storage.removeItem(key);
  }
}
