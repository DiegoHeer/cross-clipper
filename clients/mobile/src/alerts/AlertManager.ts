/**
 * AlertManager — notification policy for incoming items (Task 11).
 *
 * Ports extension background/alerts.ts behaviour EXACTLY:
 *
 *   - ULID watermark written BEFORE presenting (crash silences, never double-notifies)
 *   - id <= watermark → skip (dedup across cursor re-pulls)
 *   - own-origin → skip
 *   - targeted-at-me → always present
 *   - targeted-elsewhere → silent
 *   - untargeted → present only if notifyOnNewItems
 *
 * No badge counter (no browser action API on mobile; APNs/FCM badge lands in Phase 5).
 */
import type { Item, SyncStorage } from "@crossclipper/core";
import type { Prefs } from "../settings/prefs";

export const WATERMARK_KEY = "cc.alert.watermark";

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  title: string;
  body: string;
}

export interface AlertDeps {
  storage: SyncStorage;
  notifications: { present(payload: NotificationPayload): Promise<void> };
  getPrefs(): Promise<Prefs>;
  getSelfDeviceId(): Promise<string | null>;
}

// ─── AlertManager ────────────────────────────────────────────────────────────

/**
 * Notification policy + watermark dedup (system spec §4).
 * Injected into SyncController via the AlertSink interface.
 */
export class AlertManager {
  constructor(private readonly deps: AlertDeps) {}

  async onItem(item: Item): Promise<void> {
    // ── Watermark dedup ──────────────────────────────────────────────────────
    const watermark = await this.deps.storage.get(WATERMARK_KEY);
    if (watermark && item.id <= watermark) return;

    // Write watermark BEFORE presenting so a crash after write silences the
    // duplicate on the next delivery, never double-notifies.
    await this.deps.storage.set(WATERMARK_KEY, item.id);

    // ── Self-origin skip ─────────────────────────────────────────────────────
    const selfId = await this.deps.getSelfDeviceId();
    if (!selfId || item.origin_device_id === selfId) return;

    // ── Targeting policy ─────────────────────────────────────────────────────
    const targetedAtMe = item.target_device_id === selfId;
    const targetedElsewhere = item.target_device_id != null && !targetedAtMe;
    if (targetedElsewhere) return; // silent — only the targeted device banners

    const prefs = await this.deps.getPrefs();
    if (targetedAtMe || prefs.notifyOnNewItems) {
      await this.deps.notifications.present({
        title: targetedAtMe ? "Sent to this device" : "New item",
        body: item.body.slice(0, 120),
      });
    }
  }
}
