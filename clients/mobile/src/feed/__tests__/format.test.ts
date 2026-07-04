/**
 * format.test.ts — Task 6 TDD step 1 (failing).
 *
 * Tests for format.ts utilities: detectKind, relativeTime.
 * Ported from extension popup/format tests.
 */
import { detectKind, relativeTime } from "../format";

const NOW = new Date("2026-07-03T12:00:00Z");

describe("detectKind", () => {
  it("a lone URL (http) is a link", () => {
    expect(detectKind("https://example.com/a?b=1")).toBe("link");
  });

  it("a lone URL with leading/trailing whitespace is a link", () => {
    expect(detectKind("  http://host/path  ")).toBe("link");
  });

  it("URL embedded in text is text", () => {
    expect(detectKind("see https://example.com now")).toBe("text");
  });

  it("plain note is text", () => {
    expect(detectKind("plain note")).toBe("text");
  });

  it("multiline body with URL is text", () => {
    expect(detectKind("line1\nhttps://example.com")).toBe("text");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for < 45s", () => {
    expect(relativeTime("2026-07-03T11:59:50", NOW)).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(relativeTime("2026-07-03T11:58:00", NOW)).toBe("2m ago");
  });

  it("returns hours ago", () => {
    expect(relativeTime("2026-07-03T09:00:00", NOW)).toBe("3h ago");
  });

  it("returns days ago", () => {
    expect(relativeTime("2026-07-01T12:00:00", NOW)).toBe("2d ago");
  });

  it("treats missing timezone as UTC", () => {
    // "2026-07-03T11:00:00" = 60 min before NOW; 60m = 1h so bucket → "1h ago"
    expect(relativeTime("2026-07-03T11:00:00", NOW)).toBe("1h ago");
  });
});
