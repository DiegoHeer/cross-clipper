import type { ReactNode } from "react";
import { parseUtc } from "./model";

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

const LONE_URL = /^https?:\/\/\S+$/;
const URL_IN_TEXT = /(https?:\/\/[^\s]+)/g;

export function detectKind(body: string): "text" | "link" {
  return LONE_URL.test(body.trim()) ? "link" : "text";
}

/** Split text into nodes, wrapping URLs in anchors (extension spec §3). */
export function linkify(text: string): ReactNode[] {
  return text.split(URL_IN_TEXT).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/**
 * Client-side 256 KB cap (spec §4 step 3).
 * Counts UTF-8 bytes via TextEncoder; returns the (possibly truncated) body
 * and a flag indicating whether capping occurred.
 */
export function capByBytes(
  body: string,
  max = 262_144,
): { body: string; capped: boolean } {
  const enc = new TextEncoder();
  const bytes = enc.encode(body);
  if (bytes.length <= max) return { body, capped: false };
  // Decode the first `max` bytes back to a string (UTF-8 safe truncation).
  const dec = new TextDecoder("utf-8", { fatal: false });
  return { body: dec.decode(bytes.slice(0, max)), capped: true };
}
