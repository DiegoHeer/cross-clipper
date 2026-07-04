import type { Item, SyncStorage } from "@crossclipper/core";
import type { Prefs } from "../shared/settings";

export const WATERMARK_KEY = "cc.alert.watermark";
export const UNREAD_COUNT_KEY = "cc.alert.unreadCount";

export interface Notifier {
  notify(id: string, title: string, body: string): Promise<void>;
}

export interface AlertDeps {
  storage: SyncStorage;
  notifier: Notifier;
  setTrayState(pending: boolean): Promise<void>;
  getPrefs(): Promise<Prefs>;
  getSelfDeviceId(): Promise<string | null>;
}

/** Notification policy + tray unread state (system spec §4).
 *  ULID watermark = dedup across Tauri restarts and cursor re-pulls. */
export class AlertManager {
  constructor(private readonly deps: AlertDeps) {}

  async onItem(item: Item): Promise<void> {
    const watermark = await this.deps.storage.get(WATERMARK_KEY);
    if (watermark && item.id <= watermark) return;
    await this.deps.storage.set(WATERMARK_KEY, item.id);

    const selfId = await this.deps.getSelfDeviceId();
    if (!selfId || item.origin_device_id === selfId) return;

    // Tray nudge for ALL non-own items (badge-equivalent).
    const count =
      Number((await this.deps.storage.get(UNREAD_COUNT_KEY)) ?? "0") + 1;
    await this.deps.storage.set(UNREAD_COUNT_KEY, String(count));
    await this.deps.setTrayState(true);

    const targetedAtMe = item.target_device_id === selfId;
    const targetedElsewhere = item.target_device_id != null && !targetedAtMe;
    if (targetedElsewhere) return; // tray nudge only, never a notification

    const prefs = await this.deps.getPrefs();
    if (targetedAtMe || prefs.notifyOnNewItems) {
      const title = targetedAtMe ? "Sent to this device" : "New item";
      await this.deps.notifier.notify(`cc-item-${item.id}`, title, item.body.slice(0, 120));
    }
  }

  async clearUnread(): Promise<void> {
    await this.deps.storage.set(UNREAD_COUNT_KEY, "0");
    await this.deps.setTrayState(false);
  }
}
