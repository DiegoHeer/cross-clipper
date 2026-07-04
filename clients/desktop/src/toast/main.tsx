import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { subscribeEvents, requestBackground } from "../shared/bridge";
import { loadPrefs } from "../shared/settings";
import { initTheme } from "../theme/theme";
import { Toast } from "./Toast";
import type { ToastState } from "./Toast";
import "../theme/tokens.css";
import "../ui/ui.css";

// Tauri's invoke is a global in the webview context.
declare function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;

export function ToastApp() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  // Monotonic counter incremented on each new capture arrival so the
  // countdown effect re-runs even when countdownMs value hasn't changed.
  const [captureId, setCaptureId] = useState(0);

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

  // Listen directly on "cc:capture-result" — the channel background/main.tsx
  // emits via onCaptureResult. This is a raw Tauri event, NOT the cc:evt bus.
  // Prefs are read per-event so runtime changes take effect immediately.
  useEffect(() => {
    let live = true;
    const p = listen<{
      state: "synced" | "queued" | "sensitive" | "empty" | "unsupported" | "cancelled";
      snippet?: string;
      outboxId?: string;
    }>("cc:capture-result", ({ payload }) => {
      if (!live) return;
      void loadPrefs().then((prefs) => {
        if (!live) return;
        if (!prefs.captureToastEnabled) return;
        const countdownMs = payload.state === "synced" ? prefs.captureToastDurationMs : 0;
        setToast({
          state: payload.state,
          snippet: payload.snippet,
          outboxId: payload.outboxId,
        });
        setCountdownMs(countdownMs);
        setCaptureId((n) => n + 1);
        void invoke("show_window", { label: "toast" });
      });
    });
    return () => {
      live = false;
      p.then((u) => {
        if (u) u();
      });
    };
  }, []);

  // Subscribe to toast_update events broadcast on the cc:evt channel.
  useEffect(() => {
    let live = true;
    const p = subscribeEvents((e) => {
      if (!live) return;
      if (e.type === "toast_update") {
        // For "synced" flip (queued→synced), read prefs to get the duration.
        // For "cancelled", no prefs needed — just hide immediately.
        if (e.state === "cancelled") {
          setToast((prev) => {
            if (!prev || prev.outboxId !== e.outboxId) return prev;
            void invoke("hide_window", { label: "toast" });
            return null;
          });
        } else if (e.state === "synced") {
          void loadPrefs().then((prefs) => {
            if (!live) return;
            setToast((prev) => {
              if (!prev || prev.outboxId !== e.outboxId) return prev;
              setCountdownMs(prefs.captureToastDurationMs);
              return { ...prev, state: e.state };
            });
          });
        }
      }
    });
    return () => {
      live = false;
      p.then((u) => {
        if (u) u();
      });
    };
  }, []);

  if (!toast) return null;

  return (
    <Toast
      toast={toast}
      countdownMs={countdownMs}
      captureId={captureId}
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
