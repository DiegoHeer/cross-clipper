/**
 * notifications.ts — expo-notifications sink for AlertManager (Task 11).
 *
 * - Requests permission on first use (deferred; not at app launch).
 * - Schedules a local foreground banner via scheduleNotificationAsync.
 * - No remote push (APNs/FCM deferred to Phase 5).
 *
 * This module is NOT imported in tests — AlertManager uses an injected
 * notifications sink so tests stay pure (see AlertManager.ts deps interface).
 */
import * as ExpoNotifications from "expo-notifications";
import type { PermissionResponse } from "expo-modules-core";
import type { NotificationPayload } from "./AlertManager";

let permissionGranted = false;

async function ensurePermission(): Promise<boolean> {
  // Short-circuit only when we have a confirmed grant. A previous denial is
  // NOT cached — re-request so the user can grant permission on a later call.
  if (permissionGranted) return true;
  const result = await ExpoNotifications.requestPermissionsAsync();
  // Cast to PermissionResponse (from expo-modules-core) to access the typed
  // `granted` field — expo-notifications' NotificationPermissionsStatus extends
  // PermissionResponse from `expo` which has a broken d.ts re-export in this
  // version, causing the field to be unresolved without the explicit cast.
  const granted = (result as unknown as PermissionResponse).granted;
  if (granted) permissionGranted = true;
  return granted;
}

/**
 * Present a local notification banner.
 * Requests permission on the first call; subsequent calls use the cached flag.
 */
export async function presentNotification(payload: NotificationPayload): Promise<void> {
  const granted = await ensurePermission();
  if (!granted) return;

  await ExpoNotifications.scheduleNotificationAsync({
    content: {
      title: payload.title,
      body: payload.body,
    },
    trigger: null, // immediate local notification
  });
}

/** Notification sink object to inject into AlertManager in production. */
export const expoNotificationSink = {
  present: presentNotification,
};
