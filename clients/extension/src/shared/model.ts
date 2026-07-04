import type { Device } from "@crossclipper/core";

/** Presence is live server truth (plan decision 2): GET /devices carries `online`
 *  (device holds an open WS) and device_changed fires on presence transitions,
 *  so the cached device list is always fresh. last_seen_at is display-only. */
export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  isSelf: boolean;
  lastSeenAt: string;
}

/** Server timestamps are naive UTC (Phase 1 decision 12) — pin the zone. */
export function parseUtc(iso: string): Date {
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasZone ? iso : `${iso}Z`);
}

export function toDeviceView(d: Device, selfId: string | null): DeviceView {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    lastSeenAt: d.last_seen_at,
    online: d.online,
    isSelf: d.id === selfId,
  };
}

export function platformIcon(platform: string): string {
  switch (platform) {
    case "extension":
      return "🌐";
    case "windows":
      return "💻";
    case "ios":
    case "android":
      return "📱";
    default:
      return "⧉";
  }
}
