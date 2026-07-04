import { LazyStore } from "@tauri-apps/plugin-store";
import {
  APPEARANCE_MIRROR_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  type Appearance,
} from "../theme/theme";
import type { StoreLike } from "./storage";

export interface AuthState {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

export interface Prefs {
  notifyOnNewItems: boolean; // system spec §4: default OFF
  captureToastEnabled: boolean;
  captureToastDurationMs: number;
  launchAtLogin: boolean;
}

export interface HotkeysConfig {
  capture: string;
  flyout: string;
}

export const DEFAULT_PREFS: Prefs = {
  notifyOnNewItems: false,
  captureToastEnabled: true,
  captureToastDurationMs: 5000,
  launchAtLogin: true,
};

export const DEFAULT_HOTKEYS: HotkeysConfig = {
  capture: "Ctrl+Alt+C",
  flyout: "Ctrl+Alt+V",
};

export const AUTH_KEY = "cc.auth";
export const PREFS_KEY = "cc.prefs";
export const HOTKEYS_KEY = "cc.hotkeys";
export const APPEARANCE_KEY = "cc.appearanceStored";
export const SERVER_VERSION_KEY = "cc.serverVersion";

// ---------------------------------------------------------------------------
// Module-level store — lazily loaded (avoids Tauri call at import time).
// Tests inject a fake via __setStore.
// ---------------------------------------------------------------------------
let _store: StoreLike | null = null;

function getStore(): StoreLike {
  if (_store === null) {
    _store = new LazyStore("crossclipper.json") as unknown as StoreLike;
  }
  return _store;
}

/** Test hook: inject a fake store before each test. */
export function __setStore(s: StoreLike): void {
  _store = s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readJson<T>(key: string): Promise<T | null> {
  const raw = await getStore().get<string>(key);
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await getStore().set(key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const loadAuth = (): Promise<AuthState | null> =>
  readJson<AuthState>(AUTH_KEY);

export const saveAuth = (a: AuthState): Promise<void> => writeJson(AUTH_KEY, a);

export async function clearAuth(): Promise<void> {
  // core has no remove(); write empty sentinel (decision 2)
  await getStore().set(AUTH_KEY, "");
}

// ---------------------------------------------------------------------------
// Prefs
// ---------------------------------------------------------------------------
export async function loadPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...((await readJson<Partial<Prefs>>(PREFS_KEY)) ?? {}) };
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await loadPrefs()), ...patch };
  await writeJson(PREFS_KEY, next);
  return next;
}

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------
export async function loadHotkeys(): Promise<HotkeysConfig> {
  return {
    ...DEFAULT_HOTKEYS,
    ...((await readJson<Partial<HotkeysConfig>>(HOTKEYS_KEY)) ?? {}),
  };
}

export async function saveHotkeys(h: HotkeysConfig): Promise<void> {
  await writeJson(HOTKEYS_KEY, h);
}

// ---------------------------------------------------------------------------
// Server version (cached at onboarding / probe time)
// ---------------------------------------------------------------------------
export async function saveServerVersion(version: string): Promise<void> {
  await writeJson(SERVER_VERSION_KEY, version);
}

export async function loadServerVersion(): Promise<string | null> {
  return readJson<string>(SERVER_VERSION_KEY);
}

// ---------------------------------------------------------------------------
// Appearance (stored copy + localStorage mirror for pre-paint reads)
// ---------------------------------------------------------------------------
export async function loadAppearanceStored(): Promise<Appearance> {
  return {
    ...DEFAULT_APPEARANCE,
    ...((await readJson<Partial<Appearance>>(APPEARANCE_KEY)) ?? {}),
  };
}

/** Persist + mirror to localStorage (pre-paint sync read) + apply immediately. */
export async function saveAppearance(a: Appearance): Promise<void> {
  await writeJson(APPEARANCE_KEY, a);
  try {
    localStorage.setItem(APPEARANCE_MIRROR_KEY, JSON.stringify(a));
  } catch {
    /* non-window context — ignored */
  }
  if (typeof document !== "undefined") applyAppearance(a);
}
