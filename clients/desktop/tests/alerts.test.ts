import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import type { Prefs } from "../src/shared/settings";

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    kind: "text",
    body: `body of ${id}`,
    origin_device_id: "other",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

function makeAlerts(prefs: Partial<Prefs> = {}) {
  const notified: Array<{ id: string; title: string; body: string }> = [];
  const trayStates: boolean[] = [];
  const storage = new MemoryStorage();

  return {
    notified,
    trayStates,
    storage,
    async build() {
      const { AlertManager } = await import("../src/background/alerts");
      return new AlertManager({
        storage,
        notifier: {
          notify: async (id, title, body) => void notified.push({ id, title, body }),
        },
        setTrayState: async (pending) => void trayStates.push(pending),
        getPrefs: async () => ({
          notifyOnNewItems: false,
          captureToastEnabled: true,
          captureToastDurationMs: 5000,
          launchAtLogin: true,
          ...prefs,
        }),
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
    expect(ctx.notified).toHaveLength(1);
    expect(ctx.notified[0]!.body).toContain("body of 01A");
  });

  it("targeted at another device → tray pending only, never a notification", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true }); // even with toggle ON
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { target_device_id: "someone-else" }));
    expect(ctx.notified).toHaveLength(0);
    expect(ctx.trayStates).toContain(true);
  });

  it("untargeted → tray pending but silent by default; banner when toggle is on", async () => {
    const off = makeAlerts();
    await (await off.build()).onItem(item("01A"));
    expect(off.notified).toHaveLength(0);
    expect(off.trayStates).toContain(true);

    const on = makeAlerts({ notifyOnNewItems: true });
    await (await on.build()).onItem(item("01A"));
    expect(on.notified).toHaveLength(1);
  });

  it("own items advance the watermark without tray nudge or notification", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { origin_device_id: "self" }));
    expect(ctx.notified).toHaveLength(0);
    expect(ctx.trayStates).toHaveLength(0);
    // a re-pull that replays 01A stays silent (watermark)
    await alerts.onItem(item("01A"));
    expect(ctx.notified).toHaveLength(0);
  });

  it("the watermark survives a restart (new AlertManager over the same storage)", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    await (await ctx.build()).onItem(item("01B"));
    const again = await ctx.build(); // fresh instance, same storage
    await again.onItem(item("01A")); // older ULID than the watermark → deduplicated
    await again.onItem(item("01B")); // replay → deduplicated
    expect(ctx.notified).toHaveLength(1);
  });

  it("targeted-elsewhere: tray pending set + no notification", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { target_device_id: "other-device" }));
    expect(ctx.notified).toHaveLength(0);
    expect(ctx.trayStates).toContain(true);
  });

  it("clearUnread sets tray pending to false", async () => {
    const ctx = makeAlerts();
    const alerts = await ctx.build();
    await alerts.onItem(item("01A")); // sets tray pending true
    await alerts.clearUnread();
    expect(ctx.trayStates.at(-1)).toBe(false);
  });
});
