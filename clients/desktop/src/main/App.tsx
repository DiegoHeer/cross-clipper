import { useEffect, useMemo, useState } from "react";
import type { Item } from "@crossclipper/core";
import { Banner } from "../ui/Banner";
import { Compose } from "../ui/Compose";
import { DeviceRail } from "../ui/DeviceRail";
import { Feed } from "../ui/Feed";
import type { FeedEntry } from "../ui/FeedCard";
import { platformIcon, toDeviceView } from "../shared/model";
import { useBridge } from "./useBridge";
import { requestBackground } from "../shared/bridge";
import { writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Onboarding } from "./onboarding/Onboarding";
import { Settings } from "./settings/Settings";

export default function App() {
  const { state, api } = useBridge();
  const [filter, setFilter] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Latched onboarding flag: set once on the first ready snapshot.
  // null = not yet determined (still loading).
  // true  = show onboarding (user was not authed at first ready).
  // false = skip onboarding (user was already authed at first ready, or completed it).
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (state.ready && onboarding === null) setOnboarding(!state.authed);
  }, [state.ready, state.authed, onboarding]);

  // Clear tray unread badge on mount and whenever the window regains focus.
  useEffect(() => {
    const clearUnread = () => void requestBackground({ type: "window_opened" });
    clearUnread();
    window.addEventListener("focus", clearUnread);
    return () => window.removeEventListener("focus", clearUnread);
  }, []);

  const deviceViews = useMemo(
    () => state.devices.map((d) => toDeviceView(d, state.deviceId)),
    [state.devices, state.deviceId],
  );

  const entries = useMemo<FeedEntry[]>(() => {
    const pendingEntries: FeedEntry[] = state.pending.map((p) => ({
      item: {
        id: p.id,
        kind: p.kind,
        body: p.body,
        origin_device_id: state.deviceId ?? "",
        target_device_id: p.targetDeviceId,
        blob_id: null,
        created_at: new Date().toISOString().slice(0, 19),
        deleted_at: null,
      } as Item,
      sendState: p.failed ? ("failed" as const) : ("pending" as const),
    }));
    const synced: FeedEntry[] = state.items.map((item) => ({ item }));
    const all = [...pendingEntries, ...synced];
    return filter ? all.filter((e) => e.item.origin_device_id === filter) : all;
  }, [state.pending, state.items, state.deviceId, filter]);

  const nameOf = (id: string) => deviceViews.find((d) => d.id === id)?.name ?? "Unknown device";
  const iconOf = (id: string) =>
    platformIcon(deviceViews.find((d) => d.id === id)?.platform ?? "");

  const handleCopy = async (body: string) => {
    try {
      await clipboardWrite(body);
    } catch {
      // Fallback to clipboard API (works in dev/test environments).
      await navigator.clipboard.writeText(body);
    }
  };

  const handleOpen = (url: string) => {
    try {
      void openUrl(url);
    } catch {
      window.open(url, "_blank", "noreferrer");
    }
  };

  const handleRetry = (outboxId: string) => {
    void requestBackground({ type: "retry", outboxId });
  };

  // Loading — no snapshot yet
  if (!state.ready || onboarding === null) {
    return (
      <div className="app app-loading">
        <span>Loading…</span>
      </div>
    );
  }

  // Onboarding / reauth
  if (onboarding || state.authRequired) {
    return (
      <Onboarding
        mode={state.authRequired ? "reauth" : "fresh"}
        initialServer={state.authRequired ? (state.baseUrl ?? undefined) : undefined}
        notice={state.authRequired ? "Session expired or device revoked — sign in again." : undefined}
        onComplete={() => setOnboarding(false)}
      />
    );
  }

  if (showSettings) {
    return (
      <Settings state={state} api={api} onBack={() => setShowSettings(false)} />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <button aria-label="Settings" onClick={() => setShowSettings(true)}>⚙</button>
      </header>
      {state.authed && state.status !== "live" ? <Banner kind="reconnecting" /> : <div />}
      <div className="main">
        <DeviceRail devices={deviceViews} selected={filter} onSelect={setFilter} />
        <Feed
          entries={entries}
          selfDeviceId={state.deviceId}
          nameOf={nameOf}
          iconOf={iconOf}
          onCopy={handleCopy}
          onOpen={handleOpen}
          onDelete={(id) => void api.deleteItem(id)}
          onRetry={handleRetry}
        />
      </div>
      <Compose
        devices={deviceViews}
        onSend={(kind, body, target) => void api.send(kind, body, target)}
      />
    </div>
  );
}
