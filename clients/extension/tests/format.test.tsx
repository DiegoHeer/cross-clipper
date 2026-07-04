import { describe, expect, it } from "vitest";
import { detectKind, linkify, relativeTime } from "../src/popup/format";
import { parseUtc, platformIcon, toDeviceView } from "../src/shared/model";
import type { Device } from "@crossclipper/core";

const NOW = new Date("2026-07-03T12:00:00Z");

describe("relativeTime", () => {
  it("buckets naive-UTC timestamps", () => {
    expect(relativeTime("2026-07-03T11:59:50", NOW)).toBe("just now");
    expect(relativeTime("2026-07-03T11:58:00", NOW)).toBe("2m ago");
    expect(relativeTime("2026-07-03T09:00:00", NOW)).toBe("3h ago");
    expect(relativeTime("2026-07-01T12:00:00", NOW)).toBe("2d ago");
  });
  it("treats missing timezone as UTC", () => {
    expect(parseUtc("2026-07-03T11:00:00").toISOString()).toBe("2026-07-03T11:00:00.000Z");
  });
});

describe("detectKind", () => {
  it("a lone URL is a link; anything else is text", () => {
    expect(detectKind("https://example.com/a?b=1")).toBe("link");
    expect(detectKind("  http://host/path  ")).toBe("link");
    expect(detectKind("see https://example.com now")).toBe("text");
    expect(detectKind("plain note")).toBe("text");
  });
});

describe("linkify", () => {
  it("wraps embedded URLs in anchors", () => {
    const nodes = linkify("see https://example.com now");
    expect(nodes).toHaveLength(3);
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
    expect(toDeviceView({ ...device, online: false } as Device, "d1").online).toBe(false);
  });
  it("marks self and picks platform icons", () => {
    expect(toDeviceView(device, "d1").isSelf).toBe(true);
    expect(toDeviceView(device, "other").isSelf).toBe(false);
    expect(platformIcon("windows")).toBe("💻");
    expect(platformIcon("mystery")).toBe("⧉");
  });
});
