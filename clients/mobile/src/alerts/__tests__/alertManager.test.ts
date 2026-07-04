/**
 * AlertManager tests — TDD step 1 (Task 11).
 *
 * Ports the extension alert policy verbatim:
 *   - id <= watermark → skip (no present, watermark doesn't move backward)
 *   - own-origin → skip
 *   - targeted-at-me → always present
 *   - targeted-elsewhere → silent (no banner)
 *   - untargeted + notifyOnNewItems:false → no present
 *   - untargeted + notifyOnNewItems:true → present
 *   - re-deliver same item after cursor re-pull → presents exactly once (watermark)
 */
import { AlertManager, WATERMARK_KEY } from "../AlertManager";
import type { Item } from "@crossclipper/core";

// ─── Fakes ───────────────────────────────────────────────────────────────────

class MemoryStorage {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

interface FakeNotification {
  title: string;
  body: string;
}

function fakeItem(overrides: Partial<Item> & { id: string }): Item {
  return {
    id: overrides.id,
    kind: "text",
    body: overrides.body ?? "Hello",
    origin_device_id: overrides.origin_device_id ?? "device-A",
    target_device_id: overrides.target_device_id ?? null,
    created_at: "2026-07-04T00:00:00Z",
    deleted_at: overrides.deleted_at ?? null,
    blob_id: null,
  };
}

function makeAlertManager(
  opts: {
    notifyOnNewItems?: boolean;
    selfDeviceId?: string | null;
  } = {},
) {
  const storage = new MemoryStorage();
  const presented: FakeNotification[] = [];
  const notifications = {
    present: jest.fn(async (n: FakeNotification) => {
      presented.push(n);
    }),
  };
  const getPrefs = jest.fn().mockResolvedValue({
    notifyOnNewItems: opts.notifyOnNewItems ?? false,
  });
  const getSelfDeviceId = jest.fn().mockResolvedValue(
    opts.selfDeviceId !== undefined ? opts.selfDeviceId : "device-self",
  );

  const mgr = new AlertManager({ storage, notifications, getPrefs, getSelfDeviceId });
  return { mgr, storage, presented, notifications, getPrefs, getSelfDeviceId };
}

// ─── Watermark ────────────────────────────────────────────────────────────────

describe("watermark dedup", () => {
  it("skips items with id <= watermark", async () => {
    const { mgr, storage, presented } = makeAlertManager({ notifyOnNewItems: true });
    // Seed a watermark
    await storage.set(WATERMARK_KEY, "01JZZZZZZZZZZZZZZZZZZZZZZZ");

    // item id is lexicographically <= watermark
    const item = fakeItem({ id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
    await mgr.onItem(item);
    expect(presented).toHaveLength(0);
  });

  it("writes watermark BEFORE presenting (crash-safe ordering)", async () => {
    const { mgr, storage, presented, notifications } = makeAlertManager({
      notifyOnNewItems: true,
    });
    const calls: string[] = [];
    const originalSet = storage.set.bind(storage);
    storage.set = async (k: string, v: string) => {
      calls.push(`set:${k}`);
      return originalSet(k, v);
    };
    notifications.present = jest.fn(async (_n: FakeNotification) => {
      calls.push("present");
      presented.push({ title: "", body: "" });
    });

    const item = fakeItem({ id: "01JAAAAAAAAAAAAAAAAAAAAAAB" });
    await mgr.onItem(item);

    const watermarkIdx = calls.indexOf(`set:${WATERMARK_KEY}`);
    const presentIdx = calls.indexOf("present");
    expect(watermarkIdx).toBeGreaterThanOrEqual(0);
    expect(presentIdx).toBeGreaterThanOrEqual(0);
    expect(watermarkIdx).toBeLessThan(presentIdx);
  });

  it("presents exactly once for the same item (cursor re-pull)", async () => {
    const { mgr, presented } = makeAlertManager({ notifyOnNewItems: true });
    const item = fakeItem({ id: "01JAAAAAAAAAAAAAAAAAAAAAAC" });
    await mgr.onItem(item);
    await mgr.onItem(item); // re-deliver
    expect(presented).toHaveLength(1);
  });

  it("does not move watermark backward", async () => {
    const { mgr, storage } = makeAlertManager({ notifyOnNewItems: true });
    const high = "01JZZZZZZZZZZZZZZZZZZZZZZZ";
    await storage.set(WATERMARK_KEY, high);
    // An older item arrives (id < high)
    const oldItem = fakeItem({ id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
    await mgr.onItem(oldItem);
    // Watermark should still be the original high value
    expect(await storage.get(WATERMARK_KEY)).toBe(high);
  });
});

// ─── Own-origin ───────────────────────────────────────────────────────────────

describe("own-origin skip", () => {
  it("skips items sent from self", async () => {
    const { mgr, presented } = makeAlertManager({ notifyOnNewItems: true });
    const item = fakeItem({ id: "01JAAAAAAAAAAAAAAAAAAAAA01", origin_device_id: "device-self" });
    await mgr.onItem(item);
    expect(presented).toHaveLength(0);
  });
});

// ─── Targeted-at-me ──────────────────────────────────────────────────────────

describe("targeted-at-me", () => {
  it("always presents regardless of notifyOnNewItems:false", async () => {
    const { mgr, presented } = makeAlertManager({ notifyOnNewItems: false });
    const item = fakeItem({
      id: "01JAAAAAAAAAAAAAAAAAAAAA02",
      origin_device_id: "device-A",
      target_device_id: "device-self",
    });
    await mgr.onItem(item);
    expect(presented).toHaveLength(1);
    expect(presented[0]!.title).toMatch(/sent to this device/i);
  });
});

// ─── Targeted-elsewhere ───────────────────────────────────────────────────────

describe("targeted-elsewhere", () => {
  it("silences notification when targeted at a different device", async () => {
    const { mgr, presented } = makeAlertManager({ notifyOnNewItems: true });
    const item = fakeItem({
      id: "01JAAAAAAAAAAAAAAAAAAAAA03",
      origin_device_id: "device-A",
      target_device_id: "device-B", // not self
    });
    await mgr.onItem(item);
    expect(presented).toHaveLength(0);
  });
});

// ─── Untargeted ──────────────────────────────────────────────────────────────

describe("untargeted", () => {
  it("does not present when notifyOnNewItems is false", async () => {
    const { mgr, presented } = makeAlertManager({ notifyOnNewItems: false });
    const item = fakeItem({
      id: "01JAAAAAAAAAAAAAAAAAAAAA04",
      origin_device_id: "device-A",
      target_device_id: null,
    });
    await mgr.onItem(item);
    expect(presented).toHaveLength(0);
  });

  it("presents when notifyOnNewItems is true", async () => {
    const { mgr, presented } = makeAlertManager({ notifyOnNewItems: true });
    const item = fakeItem({
      id: "01JAAAAAAAAAAAAAAAAAAAAA05",
      origin_device_id: "device-A",
      target_device_id: null,
    });
    await mgr.onItem(item);
    expect(presented).toHaveLength(1);
    expect(presented[0]!.title).toMatch(/new item/i);
  });
});

// ─── getSelfDeviceId null ──────────────────────────────────────────────────

describe("no self device id", () => {
  it("skips when selfDeviceId is null (not yet registered)", async () => {
    const { mgr, presented } = makeAlertManager({
      selfDeviceId: null,
      notifyOnNewItems: true,
    });
    const item = fakeItem({ id: "01JAAAAAAAAAAAAAAAAAAAAA06" });
    await mgr.onItem(item);
    expect(presented).toHaveLength(0);
  });
});
