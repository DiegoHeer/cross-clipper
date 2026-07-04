/**
 * authPersist — single seam for persisting auth credentials.
 *
 * Currently writes to AsyncStorage only. PR 8 (iOS Share Extension) will
 * extend this function to also write to the App Group shared container so the
 * share extension can read the token without launching the main app.
 *
 * ── App Group seam (PR 8) ────────────────────────────────────────────────────
 * When the `expo-share-extension` native module lands, add:
 *
 *   import { appGroup } from "../platform/appGroup";
 *   await appGroup.writeAuth(bundle);
 *
 * ONLY inside this function. No other callers should touch App Group storage.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const AUTH_KEY = "cc.auth";

export interface AuthBundle {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

/** Persist auth credentials. Extend this for App Group in PR 8. */
export async function saveAuth(bundle: AuthBundle): Promise<void> {
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(bundle));
  // PR 8: also write to App Group shared container here (see module doc).
}

/** Clear auth credentials. Extend this for App Group in PR 8. */
export async function clearAuth(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY);
  // PR 8: also clear App Group shared container here.
}

/** Read current auth bundle. */
export async function loadAuth(): Promise<AuthBundle | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthBundle;
  } catch {
    return null;
  }
}
