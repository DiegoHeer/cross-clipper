import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import type { Prefs } from "../src/shared/settings";

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, kind: "text", body: `body of ${id}`, origin_device_id: "other", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null, ...over }) as Item;

function makeAlerts(prefs: Partial<Prefs> = {}) {
  const notifications: Array<{ id: string; opts: Record<string, unknown> }> = [];
  const badges: string[] = [];
  const storage = new MemoryStorage();
  return {
    notifications,
    badges,
    storage,
    async build() {
      const { AlertManager } = await import("../src/background/alerts");
      return new AlertManager({
        storage,
        notifications: { create: async (id, opts) => (notifications.push({ id, opts }), id) },
        action: {
          setBadgeText: async ({ text }) => void badges.push(text),
          setBadgeBackgroundColor: async () => undefined,
        },
        getPrefs: async () => ({ notifyOnNewItems: false, contextMenuSend: true, ...prefs }),
        getSelfDeviceId: async () => "self",
      });
    },
  };
}

describe("AlertManager policy (system spec §4)", () => {
  beforeEach(() => undefined);

  it("targeted at me → always notifies, even with the toggle off", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: false });
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { target_device_id: "self" }));
    expect(ctx.notifications).toHaveLength(1);
    expect(String(ctx.notifications[0]!.opts.message)).toContain("body of 01A");
  });

  it("targeted at another device → badge only, never a banner", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true }); // even with toggle ON
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { target_device_id: "someone-else" }));
    expect(ctx.notifications).toHaveLength(0);
    expect(ctx.badges).toContain("1");
  });

  it("untargeted → silent by default, banner when the toggle is on", async () => {
    const off = makeAlerts();
    await (await off.build()).onItem(item("01A"));
    expect(off.notifications).toHaveLength(0);
    expect(off.badges).toContain("1");

    const on = makeAlerts({ notifyOnNewItems: true });
    await (await on.build()).onItem(item("01A"));
    expect(on.notifications).toHaveLength(1);
  });

  it("own items advance the watermark without badge or banner", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { origin_device_id: "self" }));
    expect(ctx.notifications).toHaveLength(0);
    expect(ctx.badges).toHaveLength(0);
    // a re-pull that replays 01A stays silent (watermark)
    await alerts.onItem(item("01A"));
    expect(ctx.notifications).toHaveLength(0);
  });

  it("the watermark survives a restart (new AlertManager over the same storage)", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    await (await ctx.build()).onItem(item("01B"));
    const again = await ctx.build(); // fresh instance, same storage
    await again.onItem(item("01A")); // older ULID than the watermark
    await again.onItem(item("01B")); // replay
    expect(ctx.notifications).toHaveLength(1);
  });

  it("badge counts accumulate and clear on popup open", async () => {
    const ctx = makeAlerts();
    const alerts = await ctx.build();
    await alerts.onItem(item("01A"));
    await alerts.onItem(item("01B"));
    expect(ctx.badges).toEqual(["1", "2"]);
    await alerts.clearBadge();
    expect(ctx.badges.at(-1)).toBe("");
  });
});
