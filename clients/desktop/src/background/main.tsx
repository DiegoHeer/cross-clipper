/**
 * Background window bootstrap (Task 7).
 *
 * This hidden window owns the SyncEngine + Outbox (via BackgroundController)
 * and is the single source of truth for the app's sync state. All other
 * windows communicate with it through the bridge (cc:req / cc:evt / cc:reply).
 */
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { enable as autostartEnable } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { LazyStore } from "@tauri-apps/plugin-store";
import { TauriStorage, type StoreLike } from "../shared/storage";
import { serveRequests } from "../shared/bridge";
import { loadPrefs, loadAuth } from "../shared/settings";
import { AlertManager, type Notifier } from "./alerts";
import { BackgroundController } from "./controller";
import { tauriSocketFactory } from "./socket";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AUTOSTART_INIT_KEY = "cc.autostartInitialized";

// ---------------------------------------------------------------------------
// Tauri notification notifier
// ---------------------------------------------------------------------------
const tauriNotifier: Notifier = {
  async notify(_id: string, title: string, body: string): Promise<void> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === "granted";
      }
      if (granted) {
        sendNotification({ title, body });
      }
    } catch {
      // Non-fatal — notifications unavailable
    }
  },
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const store = new LazyStore("store.bin") as unknown as StoreLike;
  const storage = new TauriStorage(store);

  // Build AlertManager — wires notification policy (Task 14).
  const alertManager = new AlertManager({
    storage,
    notifier: tauriNotifier,
    setTrayState: async (pending: boolean) => {
      await invoke("set_tray_pending", { pending });
    },
    getPrefs: loadPrefs,
    getSelfDeviceId: async () => {
      const auth = await loadAuth();
      return auth?.deviceId ?? null;
    },
  });

  const controller = new BackgroundController({
    storage,
    socketFactory: tauriSocketFactory,
    onCaptureResult: (r) => {
      void emit("cc:capture-result", r);
    },
    onNewItem: (item) => {
      void alertManager.onItem(item);
    },
    onWindowOpened: () => {
      void alertManager.clearUnread();
    },
  });

  // Serve PopupRequests from renderer windows
  await serveRequests((req) => controller.handleRequest(req));

  // Subscribe to Rust capture events
  await listen<{ kind: "text" | "sensitive" | "empty" | "unsupported"; text?: string }>(
    "cc:capture",
    ({ payload }) => {
      void controller.handleCapture(payload);
    },
  );

  // Boot the sync engine
  await controller.wake();

  // Enable autostart on first successful auth (guard: run only once per install)
  const autostartDone = await storage.get(AUTOSTART_INIT_KEY);
  if (!autostartDone) {
    const snap = await controller.snapshot();
    if (snap.authed) {
      try {
        await autostartEnable();
        await storage.set(AUTOSTART_INIT_KEY, "1");
      } catch {
        // Non-fatal — autostart is best-effort on first launch
      }
    }
  }
}

main().catch(console.error);

export {};
