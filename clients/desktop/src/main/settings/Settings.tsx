import { useEffect, useState } from "react";
import { loadServerVersion } from "../../shared/settings";
import { toDeviceView } from "../../shared/model";
import type { PopupState, BridgeApi } from "../useBridge";
import { DevicesTab } from "./DevicesTab";
import { GeneralTab } from "./GeneralTab";
import { LookTab } from "./LookTab";
import { CaptureTab } from "./CaptureTab";

type Tab = "devices" | "look" | "general" | "capture";

export function Settings({
  state,
  api,
  onBack,
}: {
  state: PopupState;
  api: BridgeApi;
  onBack(): void;
}) {
  const [tab, setTab] = useState<Tab>("devices");
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    void loadServerVersion().then(setServerVersion);
  }, []);

  const host = state.baseUrl?.replace(/^https?:\/\//, "") ?? "—";
  const deviceViews = state.devices.map((d) => toDeviceView(d, state.deviceId));

  return (
    <div className="app settings">
      <header className="header">
        <button aria-label="Back" onClick={onBack}>
          ←
        </button>
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
        {(["devices", "look", "general", "capture"] as Tab[]).map((t) => (
          <button
            key={t}
            className="chip"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "devices" && <DevicesTab devices={deviceViews} api={api} />}
        {tab === "look" && <LookTab />}
        {tab === "general" && <GeneralTab />}
        {tab === "capture" && <CaptureTab />}
      </div>
    </div>
  );
}
