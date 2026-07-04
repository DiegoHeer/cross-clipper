import { useEffect, useState } from "react";

export interface ToastState {
  state: "synced" | "queued" | "sensitive" | "empty" | "unsupported" | "cancelled";
  snippet?: string;
  outboxId?: string;
}

export interface ToastProps {
  toast: ToastState;
  /** Remaining milliseconds for the auto-dismiss countdown (synced only). */
  countdownMs: number;
  onUndo(outboxId: string): void;
  onDismiss(): void;
}

/**
 * Capture toast surface — desktop spec §3.
 *
 * States:
 *   synced    → "⧉ Synced · <snippet> · [Undo] · Ns" with countdown.
 *   queued    → "queued — will sync when connected" (no countdown).
 *   sensitive → "not captured — marked sensitive".
 *   empty     → "clipboard is empty".
 *   unsupported → "images & files come in a later version".
 *   cancelled → undo was confirmed; calls onDismiss immediately.
 *
 * Amendment: the "cancelled" state was added after the original brief.
 * Behaviour: dismiss (hide) immediately. A later toast_update "cancelled"
 * for an outboxId whose Undo was already clicked is a no-op hide (same path).
 */
export function Toast({ toast, countdownMs, onUndo, onDismiss }: ToastProps) {
  const { state, snippet, outboxId } = toast;

  // Live countdown tick (seconds remaining).
  const [secsLeft, setSecsLeft] = useState(() => Math.ceil(countdownMs / 1000));

  // Sync secsLeft when countdownMs prop changes (e.g. toast_update flip).
  useEffect(() => {
    setSecsLeft(Math.ceil(countdownMs / 1000));
  }, [countdownMs]);

  // Countdown timer — only active in synced state.
  useEffect(() => {
    if (state !== "synced" || countdownMs <= 0) return;

    const interval = setInterval(() => {
      setSecsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onDismiss();
          return 0;
        }
        return s - 1;
      });
    }, 1_000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, countdownMs]);

  // "cancelled" = undo confirmed; hide immediately.
  useEffect(() => {
    if (state === "cancelled") {
      onDismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleUndo = () => {
    if (outboxId) {
      onUndo(outboxId);
    }
  };

  if (state === "cancelled") {
    // Already calling onDismiss via useEffect; render nothing visible.
    return null;
  }

  return (
    <div
      className="toast-surface"
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        fontSize: "13px",
        minWidth: "280px",
        maxWidth: "400px",
      }}
    >
      {state === "synced" && (
        <>
          <span>⧉ Synced</span>
          {snippet && (
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                color: "var(--text-muted)",
              }}
            >
              {snippet}
            </span>
          )}
          <button
            aria-label="Undo"
            onClick={handleUndo}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "2px var(--space-2)",
              cursor: "pointer",
              color: "var(--text)",
              fontSize: "12px",
            }}
          >
            Undo
          </button>
          {countdownMs > 0 && (
            <span
              className="toast-countdown"
              style={{
                color: "var(--text-muted)",
                fontSize: "0.85em",
                fontVariantNumeric: "tabular-nums",
                minWidth: "2ch",
              }}
            >
              {secsLeft}s
            </span>
          )}
        </>
      )}

      {state === "queued" && (
        <span>queued — will sync when connected</span>
      )}

      {state === "sensitive" && (
        <span>not captured — marked sensitive</span>
      )}

      {state === "empty" && (
        <span>clipboard is empty</span>
      )}

      {state === "unsupported" && (
        <span>images &amp; files come in a later version</span>
      )}
    </div>
  );
}
