import type { Item, SyncStorage } from "@crossclipper/core";
import type { Prefs } from "../shared/settings";

export const WATERMARK_KEY = "cc.alert.watermark";
export const BADGE_COUNT_KEY = "cc.badge.count";

export interface AlertDeps {
  storage: SyncStorage;
  notifications: { create(id: string, opts: Record<string, unknown>): Promise<string> };
  action: {
    setBadgeText(d: { text: string }): Promise<void>;
    setBadgeBackgroundColor(d: { color: string }): Promise<void>;
  };
  getPrefs(): Promise<Prefs>;
  getSelfDeviceId(): Promise<string | null>;
}

/** Notification policy + unread badge (system spec §4, extension spec §6).
 *  ULID watermark = dedup across MV3 worker restarts and cursor re-pulls. */
export class AlertManager {
  constructor(private readonly deps: AlertDeps) {}

  async onItem(item: Item): Promise<void> {
    const watermark = await this.deps.storage.get(WATERMARK_KEY);
    if (watermark && item.id <= watermark) return;
    await this.deps.storage.set(WATERMARK_KEY, item.id);

    const selfId = await this.deps.getSelfDeviceId();
    if (!selfId || item.origin_device_id === selfId) return;

    const count = Number((await this.deps.storage.get(BADGE_COUNT_KEY)) ?? "0") + 1;
    await this.deps.storage.set(BADGE_COUNT_KEY, String(count));
    await this.deps.action.setBadgeBackgroundColor({ color: "#d97706" });
    await this.deps.action.setBadgeText({ text: String(count) });

    const targetedAtMe = item.target_device_id === selfId;
    const targetedElsewhere = item.target_device_id != null && !targetedAtMe;
    if (targetedElsewhere) return; // badge only, never a banner

    const prefs = await this.deps.getPrefs();
    if (targetedAtMe || prefs.notifyOnNewItems) {
      await this.deps.notifications.create(`cc-item-${item.id}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: targetedAtMe ? "Sent to this device" : "New item",
        message: item.body.slice(0, 120),
      });
    }
  }

  async clearBadge(): Promise<void> {
    await this.deps.storage.set(BADGE_COUNT_KEY, "0");
    await this.deps.action.setBadgeText({ text: "" });
  }

  async flashBadge(text = "✓"): Promise<void> {
    await this.deps.action.setBadgeBackgroundColor({ color: "#16a34a" });
    await this.deps.action.setBadgeText({ text });
    setTimeout(() => {
      void (async () => {
        const count = Number((await this.deps.storage.get(BADGE_COUNT_KEY)) ?? "0");
        await this.deps.action.setBadgeBackgroundColor({ color: "#d97706" });
        await this.deps.action.setBadgeText({ text: count > 0 ? String(count) : "" });
      })();
    }, 2000);
  }
}
