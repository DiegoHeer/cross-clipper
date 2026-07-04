/**
 * useShareIntent.ts — Thin hook over expo-share-intent's native API.
 *
 * Returns { shared, reset } where:
 *   shared = null when there is no pending intent; otherwise { kind, body }.
 *   reset()  clears the pending intent so re-foregrounding does not re-open.
 *
 * Platform gating:
 *   expo-share-intent is configured with disableIOS:true in app.json (config plugin).
 *   This hook passes `disabled: Platform.OS !== 'android'` to the underlying hook
 *   as a belt-and-suspenders guard — on iOS the library skips all native calls and
 *   returns the default empty value, so `shared` is always null on iOS.
 *
 * Uses expo-share-intent v4's useShareIntent({ resetOnBackground }) API.
 * `resetOnBackground: false` — we own the reset lifecycle (reset after handling,
 *  not on every background/foreground transition).
 */
import { Platform } from "react-native";
import { useShareIntent as useExpoShareIntent } from "expo-share-intent";
import { detectKind } from "../feed/format";

// ─── Return type ─────────────────────────────────────────────────────────────

export interface SharePayload {
  kind: "text" | "link";
  body: string;
}

export interface UseShareIntentResult {
  shared: SharePayload | null;
  reset(): void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useShareIntent(): UseShareIntentResult {
  const { hasShareIntent, shareIntent, resetShareIntent } = useExpoShareIntent({
    resetOnBackground: false,
    // Disable the library on iOS — expo-share-intent is for Android only.
    // On iOS, the library returns the default empty value and skips native calls.
    disabled: Platform.OS !== "android",
  });

  if (!hasShareIntent) {
    return { shared: null, reset: resetShareIntent };
  }

  // Prefer webUrl (type==="weburl") then text.
  const rawBody = shareIntent.webUrl ?? shareIntent.text ?? "";
  const body = rawBody.trim();

  if (!body) {
    return { shared: null, reset: resetShareIntent };
  }

  const kind = detectKind(body);
  return { shared: { kind, body }, reset: resetShareIntent };
}
