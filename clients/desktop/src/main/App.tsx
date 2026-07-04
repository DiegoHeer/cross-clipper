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

export default function App() {
  const { state, api } = useBridge();
  const [filter, setFilter] = useState<string | null>(null);

  // Latched onboarding flag: set once on the first ready snapshot.
  // null = not yet determined (still loading).
  // true  = show onboarding (user was not authed at first ready).
  // false = skip onboarding (user was already authed at first ready, or completed it).
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (state.ready && onboarding === null) setOnboarding(!state.authed);
  }, [state.ready, state.authed, onboarding]);

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

  // Onboarding / auth required — Task 12 placeholder
  if (onboarding || state.authRequired) {
    return (
      <div className="app app-onboarding">
        <h1>CrossClipper</h1>
        <p>
          {/* Task 12 — Onboarding component lands in PR 7. */}
          Sign in via onboarding — coming in PR 7.
        </p>
        {state.authRequired && (
          <p className="notice">Session expired or device revoked — sign in again.</p>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        {/* Settings routes land in PR 7 — gear is a no-op placeholder */}
        <button aria-label="Settings" onClick={() => {}}>⚙</button>
      </header>
      {state.authed && state.status !== "live" ? <Banner kind="reconnecting" /> : <div />}
      <div className="main">
        <DeviceRail devices={deviceViews} selected={filter} onSelect={setFilter} />
        <Feed
          entries={entries}
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
