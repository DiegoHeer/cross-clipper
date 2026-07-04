import { useMemo, useState } from "react";
import { DeviceRail } from "./components/DeviceRail";
import { Compose } from "./components/Compose";
import { FeedCard } from "./components/FeedCard";
import { fixtureDevices, fixtureEntries } from "./fixtures";
import { platformIcon } from "../shared/model";
import { Settings } from "./settings/Settings";
import { INITIAL_STATE } from "./useWorker";
import type { WorkerApi } from "./useWorker";

const stubApi: WorkerApi = {
  send: async () => {},
  retry: async () => {},
  deleteItem: async () => {},
  refresh: async () => {},
  renameDevice: async () => {},
  revokeDevice: async () => {},
  signOut: async () => {},
};

export default function App() {
  const [filter, setFilter] = useState<string | null>(null);
  const [view, setView] = useState<"feed" | "settings">("feed");
  const devices = fixtureDevices;
  const entries = fixtureEntries;

  const visible = useMemo(
    () => (filter ? entries.filter((e) => e.item.origin_device_id === filter) : entries),
    [entries, filter],
  );
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? "Unknown device";
  const iconOf = (id: string) => platformIcon(devices.find((d) => d.id === id)?.platform ?? "");

  if (view === "settings") {
    return <Settings state={INITIAL_STATE} api={stubApi} onBack={() => setView("feed")} />;
  }

  return (
    <div className="app">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <button aria-label="Settings" onClick={() => setView("settings")}>⚙</button>
      </header>
      <div />
      <div className="main">
        <DeviceRail devices={devices} selected={filter} onSelect={setFilter} />
        <div className="feed">
          {visible.length === 0 && (
            <p className="empty">Copy something on another device, or type below.</p>
          )}
          {visible.map((entry) => (
            <FeedCard
              key={entry.item.id}
              entry={entry}
              originName={nameOf(entry.item.origin_device_id)}
              originIcon={iconOf(entry.item.origin_device_id)}
              onCopy={(body) => void navigator.clipboard.writeText(body)}
              onOpen={(url) => window.open(url)}
              onDelete={() => {}}
            />
          ))}
        </div>
      </div>
      <Compose devices={devices} onSend={() => {}} />
    </div>
  );
}
