import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { subscribeEvents, requestBackground } from "../shared/bridge";
import { initTheme } from "../theme/theme";
import { Toast } from "./Toast";
import type { ToastState } from "./Toast";
import "../theme/tokens.css";
import "../ui/ui.css";

// Auto-dismiss after 5 s for synced captures.
const SYNCED_COUNTDOWN_MS = 5_000;

// Tauri's invoke is a global in the webview context.
declare function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;

function ToastApp() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);

  const dismiss = () => {
    setToast(null);
    void invoke("hide_window", { label: "toast" });
  };

  const handleUndo = (outboxId: string) => {
    // Immediately hide; a later toast_update "cancelled" for the same outboxId
    // is a no-op hide (toast is already null by then).
    setToast(null);
    void invoke("hide_window", { label: "toast" });
    void requestBackground({ type: "undo_capture", outboxId });
  };

  // Subscribe on first render. useState initialiser runs once (no cleanup
  // needed for the toast window — it is shown/hidden, never remounted).
  useState(() => {
    void subscribeEvents((e) => {
      if (e.type === "capture_result") {
        const newToast: ToastState = {
          state: e.state,
          snippet: e.snippet,
          outboxId: e.outboxId,
        };
        setToast(newToast);
        setCountdownMs(e.state === "synced" ? SYNCED_COUNTDOWN_MS : 0);
      } else if (e.type === "toast_update") {
        // Background may flip "queued" → "synced" or confirm "cancelled".
        setToast((prev) => {
          if (!prev || prev.outboxId !== e.outboxId) return prev;
          if (e.state === "cancelled") {
            // Undo confirmed — hide the window and clear toast state.
            void invoke("hide_window", { label: "toast" });
            return null;
          }
          return { ...prev, state: e.state };
        });
        if (e.state === "synced") {
          setCountdownMs(SYNCED_COUNTDOWN_MS);
        }
      }
    });
  });

  if (!toast) return null;

  return (
    <Toast
      toast={toast}
      countdownMs={countdownMs}
      onUndo={handleUndo}
      onDismiss={dismiss}
    />
  );
}

initTheme();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <ToastApp />
    </StrictMode>,
  );
}
