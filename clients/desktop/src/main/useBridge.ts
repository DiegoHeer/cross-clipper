import { useEffect, useMemo, useReducer } from "react";
import type { Device, Item, SyncStatus } from "@crossclipper/core";
import { requestBackground, subscribeEvents } from "../shared/bridge";
import { isWorkerEvent, type PendingSend, type WorkerEvent } from "../shared/messages";

/** Mirror of the extension's PopupState — re-expressed over the Tauri bridge. */
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

/** Pure reducer — same logic as the extension's useWorker.reduce. */
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

export interface BridgeApi {
  send(kind: "text" | "link", body: string, targetDeviceId: string | null): Promise<void>;
  undoCapture(outboxId: string): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  refresh(): Promise<void>;
  renameDevice(deviceId: string, name: string): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * useBridge — the extension's useWorker re-expressed over the Tauri event bridge.
 *
 * Subscribes to `cc:evt` WorkerEvents (via subscribeEvents) and dispatches them
 * into a reducer. Requests an initial snapshot on mount. Exposes a stable `api`
 * object for RPC calls to the background window (via requestBackground).
 */
export function useBridge(): { state: PopupState; api: BridgeApi } {
  const [state, dispatch] = useReducer(
    (s: PopupState, event: WorkerEvent) => reduce(s, event),
    INITIAL_STATE,
  );

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const setup = async () => {
      unsubscribe = await subscribeEvents((e) => {
        if (isWorkerEvent(e)) {
          dispatch(e);
        }
      });
      // Request initial snapshot from the background controller.
      void requestBackground({ type: "get_state" }).then((snap) => {
        dispatch({ type: "snapshot", state: snap as never });
      });
    };

    void setup();

    return () => {
      unsubscribe?.();
    };
  }, []);

  const api = useMemo<BridgeApi>(
    () => ({
      send: async (kind, body, targetDeviceId) => {
        await requestBackground({ type: "send", kind, body, targetDeviceId });
      },
      undoCapture: async (outboxId) => {
        await requestBackground({ type: "undo_capture", outboxId });
      },
      deleteItem: async (itemId) => {
        await requestBackground({ type: "delete_item", itemId });
      },
      refresh: async () => {
        await requestBackground({ type: "refresh" });
      },
      renameDevice: async (deviceId, name) => {
        await requestBackground({ type: "rename_device", deviceId, name });
      },
      revokeDevice: async (deviceId) => {
        await requestBackground({ type: "revoke_device", deviceId });
      },
      signOut: async () => {
        await requestBackground({ type: "sign_out" });
      },
    }),
    [],
  );

  return { state, api };
}
