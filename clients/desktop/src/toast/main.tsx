import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
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
  useEffect(() => {
    let live = true;
    const p = listen<{
      state: "synced" | "queued" | "sensitive" | "empty" | "unsupported" | "cancelled";
      snippet?: string;
      outboxId?: string;
    }>("cc:capture-result", ({ payload }) => {
      if (!live) return;
      setToast({
        state: payload.state,
        snippet: payload.snippet,
        outboxId: payload.outboxId,
      });
      setCountdownMs(payload.state === "synced" ? SYNCED_COUNTDOWN_MS : 0);
      setCaptureId((n) => n + 1);
      void invoke("show_window", { label: "toast" });
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
        // Compute the outboxId match once so both setToast and setCountdownMs
        // act on the same decision (avoids unconditional countdown reset).
        setToast((prev) => {
          if (!prev || prev.outboxId !== e.outboxId) return prev;
          if (e.state === "cancelled") {
            // Undo confirmed — hide the window and clear toast state.
            void invoke("hide_window", { label: "toast" });
            return null;
          }
          if (e.state === "synced") {
            setCountdownMs(SYNCED_COUNTDOWN_MS);
          }
          return { ...prev, state: e.state };
        });
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
