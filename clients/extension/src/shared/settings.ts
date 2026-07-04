import browser from "webextension-polyfill";
import {
  APPEARANCE_MIRROR_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  type Appearance,
} from "../theme/theme";

export interface AuthState {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

export interface Prefs {
  notifyOnNewItems: boolean; // system spec §4: default OFF
  contextMenuSend: boolean;
}

export const DEFAULT_PREFS: Prefs = { notifyOnNewItems: false, contextMenuSend: true };

export const AUTH_KEY = "cc.auth";
export const PREFS_KEY = "cc.prefs";
export const APPEARANCE_KEY = "cc.appearanceStored";
export const SERVER_VERSION_KEY = "cc.serverVersion";

async function readJson<T>(key: string): Promise<T | null> {
  const res = await browser.storage.local.get(key);
  const raw = res[key];
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: JSON.stringify(value) });
}

export const loadAuth = (): Promise<AuthState | null> => readJson<AuthState>(AUTH_KEY);
export const saveAuth = (a: AuthState): Promise<void> => writeJson(AUTH_KEY, a);
export const clearAuth = (): Promise<void> => browser.storage.local.remove(AUTH_KEY);

export async function loadPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...((await readJson<Partial<Prefs>>(PREFS_KEY)) ?? {}) };
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await loadPrefs()), ...patch };
  await writeJson(PREFS_KEY, next);
  return next;
}

export async function loadAppearanceStored(): Promise<Appearance> {
  return { ...DEFAULT_APPEARANCE, ...((await readJson<Partial<Appearance>>(APPEARANCE_KEY)) ?? {}) };
}

/** Persist + mirror (pre-paint sync read) + apply immediately. */
export async function saveAppearance(a: Appearance): Promise<void> {
  await writeJson(APPEARANCE_KEY, a);
  try {
    localStorage.setItem(APPEARANCE_MIRROR_KEY, JSON.stringify(a));
  } catch {
    /* worker context has no localStorage — popup refreshes its mirror on load */
  }
  if (typeof document !== "undefined") applyAppearance(a);
}
