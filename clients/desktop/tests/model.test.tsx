import { describe, expect, it } from "vitest";
import type { Device } from "@crossclipper/core";
import { parseUtc, platformIcon, toDeviceView } from "../src/shared/model";

const NOW = new Date("2026-07-03T12:00:00Z");

describe("parseUtc", () => {
  it("treats missing timezone as UTC", () => {
    expect(parseUtc("2026-07-03T11:00:00").toISOString()).toBe(
      "2026-07-03T11:00:00.000Z",
    );
  });
});

describe("device view", () => {
  const device: Device = {
    id: "d1",
    name: "Work laptop",
    platform: "extension",
    online: true,
    last_seen_at: "2026-07-03T11:59:00",
    created_at: "2026-07-01T00:00:00",
  } as Device;

  it("passes through the server's live presence flag", () => {
    expect(toDeviceView(device, "d1").online).toBe(true);
    expect(toDeviceView({ ...device, online: false } as Device, "d1").online).toBe(
      false,
    );
  });

  it("marks self and picks platform icons", () => {
    expect(toDeviceView(device, "d1").isSelf).toBe(true);
    expect(toDeviceView(device, "other").isSelf).toBe(false);
    expect(platformIcon("windows")).toBe("💻");
    expect(platformIcon("mystery")).toBe("⧉");
  });
});

void NOW; // suppress unused import warning if tests are reorganised
