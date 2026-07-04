import { describe, expect, it } from "vitest";
import { capByBytes, detectKind, linkify, relativeTime } from "../src/shared/format";
import { parseUtc } from "../src/shared/model";

const NOW = new Date("2026-07-03T12:00:00Z");

describe("relativeTime", () => {
  it("buckets naive-UTC timestamps", () => {
    expect(relativeTime("2026-07-03T11:59:50", NOW)).toBe("just now");
    expect(relativeTime("2026-07-03T11:58:00", NOW)).toBe("2m ago");
    expect(relativeTime("2026-07-03T09:00:00", NOW)).toBe("3h ago");
    expect(relativeTime("2026-07-01T12:00:00", NOW)).toBe("2d ago");
  });

  it("treats missing timezone as UTC", () => {
    expect(parseUtc("2026-07-03T11:00:00").toISOString()).toBe(
      "2026-07-03T11:00:00.000Z",
    );
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

describe("capByBytes", () => {
  it("passes short bodies through unchanged", () => {
    expect(capByBytes("hi")).toEqual({ body: "hi", capped: false });
    expect(capByBytes("")).toEqual({ body: "", capped: false });
  });

  it("caps oversized bodies at exactly 256 KB (262144 bytes)", () => {
    const big = "x".repeat(300_000);
    const out = capByBytes(big);
    expect(out.capped).toBe(true);
    expect(new TextEncoder().encode(out.body).length).toBeLessThanOrEqual(262_144);
  });

  it("does not cap bodies at exactly the limit", () => {
    const exact = "a".repeat(262_144);
    expect(capByBytes(exact).capped).toBe(false);
  });

  it("respects a custom max", () => {
    const out = capByBytes("hello world", 5);
    expect(out.capped).toBe(true);
    expect(new TextEncoder().encode(out.body).length).toBeLessThanOrEqual(5);
  });
});
