import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeBrowser } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";
import type { PopupState, WorkerApi } from "../src/popup/useWorker";

const NOW = new Date("2026-07-03T12:00:00Z");

const devices = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, last_seen_at: "2026-07-03T11:59:30", created_at: "2026-07-01T00:00:00" },
  { id: "d2", name: "Pixel 8", platform: "android", online: true, last_seen_at: "2026-07-03T11:59:00", created_at: "2026-07-01T00:00:00" },
  { id: "d3", name: "Old tablet", platform: "other", online: false, last_seen_at: "2026-06-01T00:00:00", created_at: "2026-05-01T00:00:00" },
];

const state: PopupState = {
  ready: true, authed: true, authRequired: false,
  baseUrl: "https://clip.example.com", deviceId: "self", status: "live",
  items: [], pending: [], devices,
};

function makeApi(): WorkerApi {
  return {
    send: vi.fn(), retry: vi.fn(), deleteItem: vi.fn(), refresh: vi.fn(),
    renameDevice: vi.fn(async () => undefined), revokeDevice: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } as unknown as WorkerApi;
}

describe("Settings — shell and Devices tab", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  beforeEach(() => {
    fake = makeFakeBrowser();
    fake.storageData["cc.serverVersion"] = "0.1.0";
    setFakeBrowser(fake.browser);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    return () => vi.useRealTimers();
  });

  async function renderSettings(api = makeApi()) {
    const { Settings } = await import("../src/popup/settings/Settings");
    const onBack = vi.fn();
    render(<Settings state={state} api={api} onBack={onBack} />);
    return { api, onBack };
  }

  it("shows the server status card with host, connection and version", async () => {
    await renderSettings();
    expect(screen.getByText(/clip\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/● Connected/)).toBeInTheDocument();
    expect(await screen.findByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it("sign out calls the api and navigates back", async () => {
    vi.useRealTimers();
    const { api, onBack } = await renderSettings();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(api.signOut).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it("lists devices with this-device badge and presence", async () => {
    await renderSettings();
    expect(screen.getByText(/this device/i)).toBeInTheDocument();
    expect(screen.getAllByText(/online now/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/last seen .*ago|last seen/i)).toBeInTheDocument();
  });

  it("stale devices (≥14 days) get the revoke nudge", async () => {
    await renderSettings();
    const row = screen.getByText("Old tablet").closest(".device-row")!;
    expect(row.querySelector(".nudge")).toBeTruthy();
    const fresh = screen.getByText("Pixel 8").closest(".device-row")!;
    expect(fresh.querySelector(".nudge")).toBeFalsy();
  });

  it("inline rename submits on Enter", async () => {
    vi.useRealTimers();
    const { api } = await renderSettings();
    const row = screen.getByText("Pixel 8").closest(".device-row")!;
    await userEvent.click(row.querySelector('[aria-label="Rename"]')!);
    const input = screen.getByDisplayValue("Pixel 8");
    await userEvent.clear(input);
    await userEvent.type(input, "Phone{Enter}");
    expect(api.renameDevice).toHaveBeenCalledWith("d2", "Phone");
  });

  it("revoke needs a second confirming click", async () => {
    vi.useRealTimers();
    const { api } = await renderSettings();
    const row = screen.getByText("Pixel 8").closest(".device-row")!;
    await userEvent.click(row.querySelector('[aria-label="Revoke"]')!);
    expect(api.revokeDevice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /revoke\?/i }));
    expect(api.revokeDevice).toHaveBeenCalledWith("d2");
  });
});

describe("Settings — Look and General tabs", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  beforeEach(() => {
    fake = makeFakeBrowser();
    setFakeBrowser(fake.browser);
    localStorage.clear();
  });

  it("Look persists accent changes through saveAppearance", async () => {
    const { LookTab } = await import("../src/popup/settings/LookTab");
    render(<LookTab />);
    await userEvent.click(await screen.findByRole("button", { name: /accent #2563eb/i }));
    expect(JSON.parse(String(fake.storageData["cc.appearanceStored"]))).toMatchObject({
      accent: "#2563eb",
    });
  });

  it("General renders defaults (notify off, context menu on) and persists toggles", async () => {
    const { GeneralTab } = await import("../src/popup/settings/GeneralTab");
    render(<GeneralTab />);
    const notify = await screen.findByRole("checkbox", { name: /notify me on new items/i });
    const menu = screen.getByRole("checkbox", { name: /context-menu send/i });
    expect(notify).not.toBeChecked();
    expect(menu).toBeChecked();
    await userEvent.click(notify);
    expect(JSON.parse(String(fake.storageData["cc.prefs"]))).toMatchObject({
      notifyOnNewItems: true,
      contextMenuSend: true,
    });
  });
});
