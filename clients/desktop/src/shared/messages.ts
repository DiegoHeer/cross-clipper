import type { Device, Item, SyncStatus } from "@crossclipper/core";

// Tauri event names for the background↔renderer bridge (decision 1).
export const REQ_EVENT = "cc:req";
export const EVT_EVENT = "cc:evt";
export const REPLY_EVENT = "cc:reply";

export interface PendingSend {
  id: string;
  kind: "text" | "link";
  body: string;
  targetDeviceId: string | null;
  failed: boolean;
  errorMessage?: string;
}

export interface StateSnapshot {
  authed: boolean;
  baseUrl: string | null;
  deviceId: string | null;
  status: SyncStatus;
  items: Item[];
  pending: PendingSend[];
  devices: Device[];
}

export type PopupRequest =
  | { type: "get_state" }
  | { type: "refresh" }
  | {
      type: "send";
      kind: "text" | "link";
      body: string;
      targetDeviceId: string | null;
    }
  | { type: "retry"; outboxId: string }
  | { type: "delete_item"; itemId: string }
  | { type: "rename_device"; deviceId: string; name: string }
  | { type: "revoke_device"; deviceId: string }
  | { type: "sign_out" }
  | { type: "undo_capture"; outboxId: string }
  | { type: "window_opened" };

export type WorkerEvent =
  | { type: "snapshot"; state: StateSnapshot }
  | { type: "item"; item: Item }
  | { type: "item_deleted"; itemId: string }
  | { type: "status"; status: SyncStatus }
  | { type: "outbox_changed"; pending: PendingSend[] }
  | { type: "devices"; devices: Device[] }
  | { type: "auth_required" }
  | { type: "toast_update"; outboxId: string; state: "synced" | "cancelled" };

const isStr = (v: unknown): v is string => typeof v === "string";
const rec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

export function isPopupRequest(v: unknown): v is PopupRequest {
  if (!rec(v) || !isStr(v.type)) return false;
  switch (v.type) {
    case "get_state":
    case "refresh":
    case "sign_out":
      return true;
    case "send":
      return (
        (v.kind === "text" || v.kind === "link") &&
        isStr(v.body) &&
        (v.targetDeviceId === null || isStr(v.targetDeviceId))
      );
    case "retry":
      return isStr(v.outboxId);
    case "delete_item":
      return isStr(v.itemId);
    case "rename_device":
      return isStr(v.deviceId) && isStr(v.name);
    case "revoke_device":
      return isStr(v.deviceId);
    case "undo_capture":
      return isStr(v.outboxId);
    case "window_opened":
      return true;
    default:
      return false;
  }
}

export function isWorkerEvent(v: unknown): v is WorkerEvent {
  if (!rec(v) || !isStr(v.type)) return false;
  switch (v.type) {
    case "snapshot":
      return rec(v.state);
    case "item":
      return rec(v.item);
    case "item_deleted":
      return isStr(v.itemId);
    case "status":
      return isStr(v.status);
    case "outbox_changed":
      return Array.isArray(v.pending);
    case "devices":
      return Array.isArray(v.devices);
    case "auth_required":
      return true;
    case "toast_update":
      return isStr(v.outboxId) && isStr(v.state);
    default:
      return false;
  }
}
