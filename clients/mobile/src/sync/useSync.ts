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

// ─── Context ─────────────────────────────────────────────────────────────────

interface SyncContextValue extends SyncSnapshot {
  send(kind: "text" | "link", body: string, targetDeviceId?: string): Promise<string>;
  remove(id: string): Promise<void>;
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
    ctrlRef.current =
      injected ??
      new SyncController({
        storage: new AsyncStorageAdapter(),
        socketFactory: rnSocketFactory,
        appState: AppState,
      });
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

  const value = useMemo(
    () => ({ ...snapshot, send, remove }),
    [snapshot, send, remove],
  );

  return React.createElement(SyncContext.Provider, { value }, children);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}
