/**
 * Background window bootstrap (Task 7).
 *
 * This hidden window owns the SyncEngine + Outbox (via BackgroundController)
 * and is the single source of truth for the app's sync state. All other
 * windows communicate with it through the bridge (cc:req / cc:evt / cc:reply).
 */
import { emit, listen } from "@tauri-apps/api/event";
import { enable as autostartEnable } from "@tauri-apps/plugin-autostart";
import { LazyStore } from "@tauri-apps/plugin-store";
import { TauriStorage, type StoreLike } from "../shared/storage";
import { serveRequests } from "../shared/bridge";
import { BackgroundController } from "./controller";
import { tauriSocketFactory } from "./socket";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AUTOSTART_INIT_KEY = "cc.autostartInitialized";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const store = new LazyStore("store.bin") as unknown as StoreLike;
  const storage = new TauriStorage(store);

  const controller = new BackgroundController({
    storage,
    socketFactory: tauriSocketFactory,
    onCaptureResult: (r) => {
      void emit("cc:capture-result", r);
    },
    // onNewItem wired in Task 14 (badge / native notification)
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
