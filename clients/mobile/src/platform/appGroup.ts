/**
 * appGroup.ts — App Group shared container bridge (iOS Share Extension seam).
 *
 * The iOS Share Extension and the main app share data through an App Group
 * (group.com.crossclipper.app). This module provides the JS-layer interface
 * over the native shared-container API exposed by expo-share-extension.
 *
 * Design constraints:
 * - The native shim is INJECTABLE so jest tests never touch native modules.
 * - The default export `appGroup` uses the real native module at runtime.
 * - `makeAppGroup(shim)` creates a testable instance with a fake shim.
 * - Only `authPersist.ts` should call writeAuth/clearAuth. No other callers.
 *
 * Storage keys (mirrors the main app's AsyncStorage key convention):
 *   cc.ag.auth        — serialised AuthBundle
 *   cc.ag.outbox      — serialised OutboxMirrorEntry[]
 */
import { NativeModules } from "react-native";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthBundle {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

/** A share-extension send that failed; the main app's Outbox will retry it. */
export interface OutboxMirrorEntry {
  /** Same client-ULID that was used in the failed POST — idempotency key. */
  id: string;
  kind: "text" | "link";
  body: string;
  targetDeviceId?: string;
}

/** Minimal key-value interface satisfied by both the real native module
 *  and by a plain in-memory object in tests. */
export interface AppGroupShim {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

const AUTH_KEY = "cc.ag.auth";
const OUTBOX_KEY = "cc.ag.outbox";

export interface AppGroup {
  readAuth(): Promise<AuthBundle | null>;
  writeAuth(bundle: AuthBundle): Promise<void>;
  clearAuth(): Promise<void>;
  pushToMainOutbox(entry: OutboxMirrorEntry): Promise<void>;
  /**
   * Read the outbox mirror WITHOUT clearing it.
   * Use together with clearMainOutbox() for loss-proof drain:
   *   1. peek  — read entries
   *   2. enqueue each (per-entry try/catch, collect failures)
   *   3. clearMainOutbox() — remove all
   *   4. re-push failures back so the next wake retries them
   */
  peekMainOutbox(): Promise<OutboxMirrorEntry[]>;
  /** Clear the outbox mirror. */
  clearMainOutbox(): Promise<void>;
  /**
   * @deprecated Use peekMainOutbox() + clearMainOutbox() in SyncController for
   * loss-proof drain. Retained for App Group tests that exercise the atomic path.
   */
  drainMainOutbox(): Promise<OutboxMirrorEntry[]>;
}

/** Create an AppGroup instance bound to the given shim. */
export function makeAppGroup(shim: AppGroupShim): AppGroup {
  return {
    async readAuth(): Promise<AuthBundle | null> {
      try {
        const raw = await shim.getItem(AUTH_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as AuthBundle;
      } catch {
        return null;
      }
    },

    async writeAuth(bundle: AuthBundle): Promise<void> {
      await shim.setItem(AUTH_KEY, JSON.stringify(bundle));
    },

    async clearAuth(): Promise<void> {
      await shim.removeItem(AUTH_KEY);
    },

    async pushToMainOutbox(entry: OutboxMirrorEntry): Promise<void> {
      const raw = await shim.getItem(OUTBOX_KEY);
      const existing: OutboxMirrorEntry[] = raw ? (JSON.parse(raw) as OutboxMirrorEntry[]) : [];
      existing.push(entry);
      await shim.setItem(OUTBOX_KEY, JSON.stringify(existing));
    },

    async peekMainOutbox(): Promise<OutboxMirrorEntry[]> {
      const raw = await shim.getItem(OUTBOX_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as OutboxMirrorEntry[];
    },

    async clearMainOutbox(): Promise<void> {
      await shim.removeItem(OUTBOX_KEY);
    },

    async drainMainOutbox(): Promise<OutboxMirrorEntry[]> {
      const raw = await shim.getItem(OUTBOX_KEY);
      if (!raw) return [];
      const entries = JSON.parse(raw) as OutboxMirrorEntry[];
      await shim.removeItem(OUTBOX_KEY);
      return entries;
    },
  };
}

// ─── Default runtime instance ─────────────────────────────────────────────────

/**
 * Runtime shim backed by expo-share-extension's NativeSharedContainer module.
 *
 * expo-share-extension exposes `NativeModules.SharedGroupPreferences` (or
 * `ExpoSharedGroupPreferences`) with getItem / setItem / removeItem that write
 * to the App Group container identified during prebuild. If the native module
 * is unavailable (e.g. in test or non-iOS environments) we fall back to a
 * no-op shim so the module loads without crashing.
 */
function buildNativeShim(): AppGroupShim {
  // expo-share-extension registers the shared container under this name.
  // The exact name may differ by version; fall back to a no-op if absent.
  const candidate =
    (NativeModules.ExpoSharedGroupPreferences as AppGroupShim | undefined) ??
    (NativeModules.SharedGroupPreferences as AppGroupShim | undefined);

  if (candidate != null && typeof candidate.getItem === "function") {
    return candidate;
  }

  // No-op fallback — means App Group is not available (non-iOS, test, etc.)
  // Main app still persists auth to AsyncStorage; share extension won't work
  // without the native prebuild, which is expected until device testing.
  const mem: Record<string, string> = {};
  return {
    async getItem(key: string) {
      return mem[key] ?? null;
    },
    async setItem(key: string, value: string) {
      mem[key] = value;
    },
    async removeItem(key: string) {
      delete mem[key];
    },
  };
}

/** Singleton App Group instance for use in the main app (auth persistence). */
export const appGroup: AppGroup = makeAppGroup(buildNativeShim());
