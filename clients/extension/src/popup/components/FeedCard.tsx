import { useState } from "react";
import type { Item } from "@crossclipper/core";
import { linkify, relativeTime } from "../format";

export interface FeedEntry {
  item: Item;
  sendState?: "pending" | "failed";
}

export interface FeedCardProps {
  entry: FeedEntry;
  originName: string;
  originIcon: string;
  onCopy(body: string): void | Promise<void>;
  onOpen(url: string): void;
  onDelete(id: string): void;
  onRetry?(id: string): void;
}

export function FeedCard({
  entry,
  originName,
  originIcon,
  onCopy,
  onOpen,
  onDelete,
  onRetry,
}: FeedCardProps) {
  const { item, sendState } = entry;
  const [copied, setCopied] = useState(false);

  // Unknown kind — render fallback (extension spec §3)
  if (item.kind !== "text" && item.kind !== "link") {
    return (
      <article
        className="card card-unsupported"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)",
        }}
      >
        <header style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
          <span aria-hidden>{originIcon}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "0.8em" }}>{originName}</span>
        </header>
        <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
          unsupported item — update client
        </p>
      </article>
    );
  }

  const handleCopy = async () => {
    await onCopy(item.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article
      className="card"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
      }}
    >
      <header
        style={{
          display: "flex",
          gap: "var(--space-2)",
          marginBottom: "var(--space-2)",
          alignItems: "center",
        }}
      >
        <span aria-hidden>{originIcon}</span>
        <span style={{ fontWeight: 500 }}>{originName}</span>
        <span style={{ color: "var(--text-muted)", fontSize: "0.8em", marginLeft: "auto" }}>
          {relativeTime(item.created_at)}
        </span>
      </header>

      <div className="card-body" style={{ marginBottom: "var(--space-2)" }}>
        {linkify(item.body)}
      </div>

      {sendState === "failed" ? (
        <div className="card-actions">
          <button
            onClick={() => onRetry?.(item.id)}
            style={{
              background: "var(--danger)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-1) var(--space-2)",
              cursor: "pointer",
            }}
          >
            Not sent — tap to retry
          </button>
        </div>
      ) : sendState === "pending" ? (
        <div className="card-actions">
          <span style={{ color: "var(--text-muted)", fontSize: "0.8em" }}>Sending…</span>
        </div>
      ) : (
        <div className="card-actions" style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            onClick={handleCopy}
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-1) var(--space-2)",
              cursor: "pointer",
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>

          {item.kind === "link" && (
            <button
              onClick={() => onOpen(item.body)}
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--space-1) var(--space-2)",
                cursor: "pointer",
              }}
            >
              Open
            </button>
          )}

          <button
            onClick={() => onDelete(item.id)}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "var(--space-1)",
            }}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
