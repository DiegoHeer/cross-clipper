import type { Item } from "@crossclipper/core";
import type { FeedEntry } from "./components/FeedCard";
import type { DeviceView } from "../shared/model";

export const fixtureDevices: DeviceView[] = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, isSelf: true, lastSeenAt: "2026-07-03T11:59:30" },
  { id: "d2", name: "Pixel 8", platform: "android", online: true, isSelf: false, lastSeenAt: "2026-07-03T11:58:00" },
  { id: "d3", name: "Old tablet", platform: "other", online: false, isSelf: false, lastSeenAt: "2026-06-01T00:00:00" },
];

const item = (id: string, over: Partial<Item>): Item =>
  ({
    id,
    kind: "text",
    body: "",
    origin_device_id: "self",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T11:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

export const fixtureEntries: FeedEntry[] = [
  { item: item("01J2", { kind: "link", body: "https://example.com/article", origin_device_id: "d2" }) },
  { item: item("01J1", { body: "meeting notes draft — remember the deployment checklist" }) },
];
