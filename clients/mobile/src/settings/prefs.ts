/**
 * prefs.ts — Mobile preferences backed by AsyncStorage (Task 9).
 *
 * Mirrors the extension's Prefs module. Storage key: "cc.prefs".
 * Single field: `notifyOnNewItems` (default off).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const PREFS_KEY = "cc.prefs";

export interface Prefs {
  /** When true, raise a banner for every new (untargeted) item. Default: false. */
  notifyOnNewItems: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  notifyOnNewItems: false,
};

/** Load prefs from AsyncStorage, merging with defaults for missing keys. */
export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist prefs to AsyncStorage. */
export async function savePrefs(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
