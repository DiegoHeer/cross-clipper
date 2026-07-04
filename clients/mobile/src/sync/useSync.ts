/**
 * useSync — React context hook consumed by every screen.
 *
 * SyncProvider owns a SyncController instance and re-renders on every
 * onChange() emission. Screens call useSync() to get the snapshot + actions.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { AsyncStorageAdapter } from "../platform/storage";
import { rnSocketFactory } from "../platform/socket";
import { SyncController } from "./SyncController";
import type { SyncSnapshot } from "./SyncController";
import { AlertManager } from "../alerts/AlertManager";
import { expoNotificationSink } from "../alerts/notifications";
import { loadPrefs } from "../settings/prefs";
import { appGroup } from "../platform/appGroup";

// ─── Context ─────────────────────────────────────────────────────────────────

interface SyncContextValue extends SyncSnapshot {
  send(kind: "text" | "link", body: string, targetDeviceId?: string): Promise<string>;
  remove(id: string): Promise<void>;
  renameDevice(id: string, name: string): Promise<void>;
  revokeDevice(id: string): Promise<void>;
  /** Call after authPersist.saveAuth() to wake the engine with new credentials. */
  onSignedIn(): Promise<void>;
  /** Stop the engine and clear in-memory auth. Caller clears storage first. */
  signOut(): void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

/** Props for testing — lets tests inject a pre-constructed controller. */
interface SyncProviderProps {
  children: React.ReactNode;
  controller?: SyncController;
}

export function SyncProvider({ children, controller: injected }: SyncProviderProps): React.JSX.Element {
  const ctrlRef = useRef<SyncController | null>(null);

  if (!ctrlRef.current) {
    if (injected) {
      ctrlRef.current = injected;
    } else {
      const storage = new AsyncStorageAdapter();
      // Wire AlertManager as the alertSink so SyncController notifies on new items.
      // AlertManager consumes items; it does not drive sync.
      const alertSink = new AlertManager({
        storage,
        notifications: expoNotificationSink,
        getPrefs: loadPrefs,
        getSelfDeviceId: async () => ctrlRef.current?.snapshot().selfDeviceId ?? null,
      });
      ctrlRef.current = new SyncController({
        storage,
        socketFactory: rnSocketFactory,
        appState: AppState,
        alertSink,
        appGroup,
      });
    }
  }
  const ctrl = ctrlRef.current;

  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() => ctrl.snapshot());

  useEffect(() => {
    const unsub = ctrl.onChange(() => setSnapshot(ctrl.snapshot()));
    ctrl.attachAppState();
    void ctrl.wake();
    return unsub;
  }, [ctrl]);

  const send = useCallback(
    (kind: "text" | "link", body: string, targetDeviceId?: string) =>
      ctrl.send(kind, body, targetDeviceId),
    [ctrl],
  );

  const remove = useCallback((id: string) => ctrl.remove(id), [ctrl]);

  const renameDevice = useCallback(
    (id: string, name: string) => ctrl.renameDevice(id, name),
    [ctrl],
  );

  const revokeDevice = useCallback((id: string) => ctrl.revokeDevice(id), [ctrl]);

  const onSignedIn = useCallback(() => ctrl.onSignedIn(), [ctrl]);
  const signOut = useCallback(() => ctrl.signOut(), [ctrl]);

  const value = useMemo(
    () => ({ ...snapshot, send, remove, renameDevice, revokeDevice, onSignedIn, signOut }),
    [snapshot, send, remove, renameDevice, revokeDevice, onSignedIn, signOut],
  );

  return React.createElement(SyncContext.Provider, { value }, children);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}
