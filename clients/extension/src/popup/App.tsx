import { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import type { Item } from "@crossclipper/core";
import { Banner } from "./components/Banner";
import { Compose } from "./components/Compose";
import { DeviceRail } from "./components/DeviceRail";
import { Feed } from "./components/Feed";
import type { FeedEntry } from "./components/FeedCard";
import { platformIcon, toDeviceView } from "../shared/model";
import { Settings } from "./settings/Settings";
import { useWorker } from "./useWorker";
import { Onboarding } from "./onboarding/Onboarding";

export default function App() {
  const { state, api } = useWorker();
  const [filter, setFilter] = useState<string | null>(null);
  const [view, setView] = useState<"feed" | "settings">("feed");

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

  if (!state.ready || onboarding === null) return <div className="app" />;

  if (onboarding || state.authRequired) {
    return (
      <Onboarding
        mode={state.authRequired ? "reauth" : "fresh"}
        initialServer={state.baseUrl ?? undefined}
        notice={state.authRequired ? "Session expired or device revoked — sign in again." : undefined}
        onComplete={() => {
          setOnboarding(false);
          void api.refresh();
        }}
      />
    );
  }

  if (view === "settings") {
    return <Settings state={state} api={api} onBack={() => setView("feed")} />;
  }

  return (
    <div className="app">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <button aria-label="Settings" onClick={() => setView("settings")}>⚙</button>
      </header>
      {state.authed && state.status !== "live" ? <Banner kind="reconnecting" /> : <div />}
      <div className="main">
        <DeviceRail devices={deviceViews} selected={filter} onSelect={setFilter} />
        <Feed
          entries={entries}
          nameOf={nameOf}
          iconOf={iconOf}
          onCopy={(body) => void navigator.clipboard.writeText(body)}
          onOpen={(url) => void browser.tabs.create({ url })}
          onDelete={(id) => void api.deleteItem(id)}
          onRetry={(id) => void api.retry(id)}
        />
      </div>
      <Compose
        devices={deviceViews}
        onSend={(kind, body, target) => void api.send(kind, body, target)}
      />
    </div>
  );
}
