import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { SERVER_VERSION_KEY } from "../../shared/settings";
import { toDeviceView } from "../../shared/model";
import type { PopupState, WorkerApi } from "../useWorker";
import { DevicesTab } from "./DevicesTab";
import { GeneralTab } from "./GeneralTab";
import { LookTab } from "./LookTab";

type Tab = "devices" | "look" | "general";

export function Settings({ state, api, onBack }: { state: PopupState; api: WorkerApi; onBack(): void }) {
  const [tab, setTab] = useState<Tab>("devices");
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    void browser.storage.local.get(SERVER_VERSION_KEY).then((res) => {
      const v = res[SERVER_VERSION_KEY];
      if (typeof v === "string") setServerVersion(v);
    });
  }, []);

  const host = state.baseUrl?.replace(/^https?:\/\//, "") ?? "—";
  const deviceViews = state.devices.map((d) => toDeviceView(d, state.deviceId));

  return (
    <div className="app settings">
      <header className="header">
        <button aria-label="Back" onClick={onBack}>←</button>
        <span>Settings</span>
        <span />
      </header>
      <section className="card status-card">
        <div>
          <strong>{host}</strong>
          <span className={state.status === "live" ? "success" : "text-muted"}>
            {state.status === "live" ? " ● Connected" : " ● Disconnected"}
          </span>
        </div>
        <div className="text-muted">{serverVersion ? `Server v${serverVersion}` : ""}</div>
        <button
          className="danger"
          onClick={() => {
            void api.signOut();
            onBack();
          }}
        >
          Sign out
        </button>
      </section>
      <nav className="chips tabs" role="tablist">
        {(["devices", "look", "general"] as Tab[]).map((t) => (
          <button key={t} className="chip" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "devices" && <DevicesTab devices={deviceViews} api={api} />}
        {tab === "look" && <LookTab />}
        {tab === "general" && <GeneralTab />}
      </div>
    </div>
  );
}
