import { useEffect, useMemo, useReducer } from "react";
import browser from "webextension-polyfill";
import type { Device, Item, SyncStatus } from "@crossclipper/core";
import {
  EVENTS_PORT,
  isWorkerEvent,
  requestWorker,
  type PendingSend,
  type WorkerEvent,
} from "../shared/messages";

export interface PopupState {
  ready: boolean;
  authed: boolean;
  authRequired: boolean;
  baseUrl: string | null;
  deviceId: string | null;
  status: SyncStatus;
  items: Item[];
  pending: PendingSend[];
  devices: Device[];
}

export const INITIAL_STATE: PopupState = {
  ready: false,
  authed: false,
  authRequired: false,
  baseUrl: null,
  deviceId: null,
  status: "stopped",
  items: [],
  pending: [],
  devices: [],
};

function insertDesc(items: Item[], item: Item): Item[] {
  if (items.some((i) => i.id === item.id)) return items;
  return [...items, item].sort((a, b) => (a.id > b.id ? -1 : 1));
}

export function reduce(state: PopupState | undefined, event: WorkerEvent): PopupState {
  const s = state ?? INITIAL_STATE;
  switch (event.type) {
    case "snapshot":
      return { ...s, ...event.state, ready: true, authRequired: false };
    case "item":
      return { ...s, items: insertDesc(s.items, event.item) };
    case "item_deleted":
      return { ...s, items: s.items.filter((i) => i.id !== event.itemId) };
    case "status":
      return { ...s, status: event.status };
    case "outbox_changed":
      return { ...s, pending: event.pending };
    case "devices":
      return { ...s, devices: event.devices };
    case "auth_required":
      return { ...s, authRequired: true };
    default:
      return s;
  }
}

export interface WorkerApi {
  send(kind: "text" | "link", body: string, targetDeviceId: string | null): Promise<void>;
  retry(outboxId: string): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  refresh(): Promise<void>;
  renameDevice(deviceId: string, name: string): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;
  signOut(): Promise<void>;
}

export function useWorker(): { state: PopupState; api: WorkerApi } {
  const [state, dispatch] = useReducer(
    (s: PopupState, event: WorkerEvent) => reduce(s, event),
    INITIAL_STATE,
  );

  useEffect(() => {
    const port = browser.runtime.connect({ name: EVENTS_PORT });

    const onMessage = (msg: unknown) => {
      if (isWorkerEvent(msg)) {
        dispatch(msg);
      }
    };

    port.onMessage.addListener(onMessage);

    return () => {
      port.onMessage.removeListener(onMessage);
      port.disconnect();
    };
  }, []);

  const api = useMemo<WorkerApi>(
    () => ({
      send: async (kind, body, targetDeviceId) => {
        await requestWorker({ type: "send", kind, body, targetDeviceId });
      },
      retry: async (outboxId) => {
        await requestWorker({ type: "retry", outboxId });
      },
      deleteItem: async (itemId) => {
        await requestWorker({ type: "delete_item", itemId });
      },
      refresh: async () => {
        await requestWorker({ type: "refresh" });
      },
      renameDevice: async (deviceId, name) => {
        await requestWorker({ type: "rename_device", deviceId, name });
      },
      revokeDevice: async (deviceId) => {
        await requestWorker({ type: "revoke_device", deviceId });
      },
      signOut: async () => {
        await requestWorker({ type: "sign_out" });
      },
    }),
    [],
  );

  return { state, api };
}
