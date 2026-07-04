import type { SyncStorage } from "@crossclipper/core";

/** Minimal interface that the real @tauri-apps/plugin-store Store satisfies. */
export interface StoreLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

/**
 * TauriStorage — SyncStorage backed by @tauri-apps/plugin-store.
 *
 * Keys are stored as raw strings (no extra JSON serialisation layer).
 * Core owns cc.cursor / cc.outbox; this store also holds cc.items,
 * cc.itemTombstones, cc.devices, cc.auth, cc.prefs, cc.appearanceStored,
 * cc.serverVersion, cc.hotkeys, cc.alert.watermark, cc.autostartInitialized, cc.pendingCancels.
 *
 * Sign-out convention (decision 2): because core has no `remove` method,
 * sign-out writes "" / "[]" to the relevant keys rather than deleting them.
 * TauriStorage therefore stores and returns the empty string as-is — callers
 * must treat "" as "cleared" where appropriate.
 */
export class TauriStorage implements SyncStorage {
  constructor(private readonly store: StoreLike) {}

  async get(key: string): Promise<string | null> {
    const v = await this.store.get<string>(key);
    if (v === null || v === undefined) return null;
    return v;
  }

  async set(key: string, value: string): Promise<void> {
    await this.store.set(key, value);
  }
}
