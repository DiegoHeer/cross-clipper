import type { ReactNode } from "react";
import { parseUtc } from "../shared/model";

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
