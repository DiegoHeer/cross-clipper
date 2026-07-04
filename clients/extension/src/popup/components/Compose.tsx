import { useState } from "react";
import type { DeviceView } from "../../shared/model";
import { detectKind } from "../format";
import { TargetPicker } from "./TargetPicker";

export interface ComposeProps {
  devices: DeviceView[];
  onSend(kind: "text" | "link", body: string, targetDeviceId: string | null): void;
}

/** Extension spec §3: input grows to ~4 lines; Enter sends, Shift+Enter newline.
 *  Plan decision 6: kind detected via detectKind at send time.
 *  Plan decision 7: target picker excludes self, resets to Silent after each send. */
export function Compose({ devices, onSend }: ComposeProps) {
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const rows = Math.min(4, body.split("\n").length);

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSend(detectKind(trimmed), trimmed, target);
    setBody("");
    setTarget(null);
  };

  return (
    <div
      className="compose"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-2)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <TargetPicker devices={devices} target={target} onChange={setTarget} />
      <div
        className="compose-row"
        style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}
      >
        <textarea
          rows={rows}
          value={body}
          placeholder="Type or paste…"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flex: 1,
            resize: "none",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2)",
            color: "var(--text)",
            fontFamily: "var(--font-ui)",
            fontSize: "0.95em",
            lineHeight: 1.5,
          }}
        />
        <button
          aria-label="Send"
          onClick={send}
          style={{
            background: "var(--accent)",
            color: "var(--accent-fg)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
