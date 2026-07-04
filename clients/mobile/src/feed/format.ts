/**
 * format.ts — feed formatting utilities.
 *
 * Ported from clients/extension/src/popup/format.ts.
 * Pure functions, no React, no side effects.
 */

// ─── Kind detection ───────────────────────────────────────────────────────────

/** A trimmed string that is exactly one HTTP(S) URL is classified as "link". */
const LONE_URL = /^https?:\/\/\S+$/;

/**
 * Classify a body string as "link" or "text" at send time.
 * Decision 5 (plan): lone URL → link; anything else → text.
 */
export function detectKind(body: string): "text" | "link" {
  return LONE_URL.test(body.trim()) ? "link" : "text";
}

// ─── Relative time ────────────────────────────────────────────────────────────

/**
 * Parse a naive UTC ISO string (no timezone suffix) or a full ISO string.
 * Naive strings (no Z / offset) are treated as UTC by appending "Z".
 */
function parseUtc(iso: string): Date {
  return new Date(iso.includes("Z") || iso.includes("+") || iso.match(/[+-]\d{2}:\d{2}$/) ? iso : iso + "Z");
}

/**
 * Format an ISO timestamp as a human-friendly relative time.
 * Mirrors the extension's relativeTime bucket thresholds exactly.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - parseUtc(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return parseUtc(iso).toLocaleDateString();
}

// ─── Platform icons (mobile device types) ────────────────────────────────────

/** Map a device platform string to a display emoji icon. */
export function platformIcon(platform: string): string {
  switch (platform) {
    case "ios":
      return "📱";
    case "android":
      return "🤖";
    case "windows":
      return "💻";
    case "extension":
      return "🌐";
    default:
      return "⧉";
  }
}
