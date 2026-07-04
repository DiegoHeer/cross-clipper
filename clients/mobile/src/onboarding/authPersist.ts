/**
 * authPersist — single seam for persisting auth credentials.
 *
 * Writes to AsyncStorage (main app) AND the App Group shared container
 * (iOS Share Extension). The share extension reads the token from the App
 * Group on mount — it never launches the main app.
 *
 * ── App Group seam ───────────────────────────────────────────────────────────
 * Only this module touches App Group auth storage. No other callers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { appGroup } from "../platform/appGroup";

export const AUTH_KEY = "cc.auth";

export interface AuthBundle {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

/** Persist auth credentials to AsyncStorage and the App Group container. */
export async function saveAuth(bundle: AuthBundle): Promise<void> {
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(bundle));
  // Also write to App Group so the iOS Share Extension can read the token.
  await appGroup.writeAuth(bundle);
}

/** Clear auth credentials from AsyncStorage and the App Group container. */
export async function clearAuth(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY);
  // Also clear from App Group on sign-out.
  await appGroup.clearAuth();
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
