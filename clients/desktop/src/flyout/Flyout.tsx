import { useBridge } from "../main/useBridge";
import { toDeviceView } from "../shared/model";
import { FeedCard } from "../ui/FeedCard";
import { Compose } from "../ui/Compose";

/**
 * Flyout surface — desktop spec §3.
 *
 * Shows the last 5 clipboard items + compose + disabled drop zone.
 * Wired to the background via useBridge. Deliberately thin: no sync
 * logic lives here — all intelligence is in packages/core via the
 * background controller.
 */
export function Flyout() {
  const { state, api } = useBridge();

  const devices = state.devices.map((d) => toDeviceView(d, state.deviceId));

  // Merge pending items into the feed (pending are also shown in the feed
  // via the sendState field — same pattern as the extension).
  const pendingIds = new Set(state.pending.map((p) => p.id));
  const last5 = state.items.slice(0, 5);

  const originName = (originDeviceId: string) => {
    const d = state.devices.find((x) => x.id === originDeviceId);
    return d?.name ?? "Unknown";
  };

  const originIcon = (originDeviceId: string) => {
    const d = state.devices.find((x) => x.id === originDeviceId);
    const platform = d?.platform ?? "";
    switch (platform) {
      case "windows": return "💻";
      case "extension": return "🌐";
      case "ios":
      case "android": return "📱";
      default: return "⧉";
    }
  };

  const sendState = (itemId: string) => {
    const p = state.pending.find((x) => x.id === itemId);
    if (!p) return undefined;
    return p.failed ? "failed" as const : "pending" as const;
  };

  // Tauri clipboard write — use the plugin when the desktop has it wired;
  // for now use the raw invoke (plugin is declared in PR 1 capabilities).
  const handleCopy = async (body: string) => {
    try {
      // @ts-expect-error — __TAURI__ global not typed in this tsconfig
      await window.__TAURI__?.tauri?.invoke("plugin:clipboard-manager|write_text", { text: body });
    } catch {
      // Fallback to clipboard API (works in dev/test environments).
      await navigator.clipboard.writeText(body);
    }
  };

  const handleOpen = (url: string) => {
    // Use the opener plugin (wired in capabilities); ignore in test/dev.
    try {
      // @ts-expect-error — __TAURI__ global not typed in this tsconfig
      void window.__TAURI__?.opener?.openUrl(url);
    } catch {
      window.open(url, "_blank", "noreferrer");
    }
  };

  if (!state.ready) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-muted)",
          fontSize: "0.9em",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div
      className="flyout-surface"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
        fontFamily: "var(--font-ui)",
        color: "var(--text)",
      }}
    >
      {/* Feed — last 5 items */}
      <div
        className="feed"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-2)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {last5.length === 0 && (
          <p style={{ color: "var(--text-muted)", textAlign: "center", fontSize: "0.9em" }}>
            No clipboard items yet.
          </p>
        )}
        {last5.map((item) => (
          <FeedCard
            key={item.id}
            entry={{ item, sendState: sendState(item.id) }}
            originName={originName(item.origin_device_id)}
            originIcon={originIcon(item.origin_device_id)}
            onCopy={handleCopy}
            onOpen={handleOpen}
            onDelete={(id) => void api.deleteItem(id)}
            onRetry={
              pendingIds.has(item.id)
                ? (id) => void requestBackground_retry(id)
                : undefined
            }
          />
        ))}
      </div>

      {/* Compose + disabled drop zone (rendered inside Compose) */}
      <Compose
        devices={devices}
        onSend={(kind, body, targetDeviceId) => void api.send(kind, body, targetDeviceId)}
      />
    </div>
  );
}

// Thin helper — avoids importing requestBackground directly (keeps coupling clear).
function requestBackground_retry(_outboxId: string) {
  // Retry is handled by the background via the bridge.
  // This path is exercised when a pending item enters "failed" state.
  // Full retry wiring is in Task 11's full-window App; the flyout just shows
  // the retry affordance — the actual retry RPC is the same bridge call.
  void import("../shared/bridge").then(({ requestBackground }) =>
    requestBackground({ type: "retry", outboxId: _outboxId }),
  );
}
