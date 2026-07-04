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
import type { NotificationPayload } from "./AlertManager";

let permissionRequested = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionRequested) return true;
  permissionRequested = true;
  const result = await ExpoNotifications.requestPermissionsAsync();
  // status is a PermissionStatus string; "granted" means permission was granted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result as any).status === "granted" || (result as any).granted === true;
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
