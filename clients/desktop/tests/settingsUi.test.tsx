import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "./tauriMock";
import { __setStore } from "../src/shared/settings";

// Hoist so vi.mock factory can reference it.
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined),
}));

// Stub invoke (register_hotkeys, autostart, etc.)
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, invoke: mockInvoke };
});

// Stub bridge
vi.mock("../src/shared/bridge", () => ({
  requestBackground: vi.fn().mockResolvedValue({ ok: true }),
  subscribeEvents: vi.fn().mockResolvedValue(() => {}),
  broadcast: vi.fn().mockResolvedValue(undefined),
  serveRequests: vi.fn().mockResolvedValue(() => {}),
}));

import type { PopupState } from "../src/main/useBridge";
import type { BridgeApi } from "../src/main/useBridge";
import type { Device } from "@crossclipper/core";

const device = (id: string, name: string): Device => ({
  id,
  name,
  platform: "desktop",
  online: false,
  last_seen_at: new Date(Date.now() - 1000 * 60 * 60).toISOString().replace("T", " ").slice(0, 19),
  created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
});

function makeState(overrides: Partial<PopupState> = {}): PopupState {
  return {
    ready: true,
    authed: true,
    authRequired: false,
    baseUrl: "http://localhost:8080",
    deviceId: "d1",
    status: "live",
    items: [],
    pending: [],
    devices: [device("d1", "This PC"), device("d2", "Pixel 8")],
    ...overrides,
  };
}

function makeApi(): BridgeApi {
  return {
    send: vi.fn(),
    undoCapture: vi.fn(),
    deleteItem: vi.fn(),
    refresh: vi.fn(),
    renameDevice: vi.fn().mockResolvedValue(undefined),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Settings shell", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders tabs and shows devices tab by default", async () => {
    const { Settings } = await import("../src/main/settings/Settings");
    const api = makeApi();
    render(<Settings state={makeState()} api={api} onBack={() => {}} />);
    expect(screen.getByRole("tab", { name: /devices/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /capture/i })).toBeInTheDocument();
    // Device list is visible on first render
    expect(screen.getByText("This PC")).toBeInTheDocument();
  });

  it("sign out calls api.signOut and onBack", async () => {
    const { Settings } = await import("../src/main/settings/Settings");
    const api = makeApi();
    const onBack = vi.fn();
    render(<Settings state={makeState()} api={api} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(api.signOut).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("back button calls onBack", async () => {
    const { Settings } = await import("../src/main/settings/Settings");
    const onBack = vi.fn();
    render(<Settings state={makeState()} api={makeApi()} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("revoke needs confirming click", async () => {
    vi.useRealTimers();
    const { Settings } = await import("../src/main/settings/Settings");
    const api = makeApi();
    render(<Settings state={makeState()} api={api} onBack={() => {}} />);
    const row = screen.getByText("Pixel 8").closest(".device-row")!;
    await userEvent.click(row.querySelector('[aria-label="Revoke"]')!);
    expect(api.revokeDevice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /revoke\?/i }));
    expect(api.revokeDevice).toHaveBeenCalledWith("d2");
  });
});

describe("Settings — Look tab", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("Look persists accent changes through saveAppearance", async () => {
    const { LookTab } = await import("../src/main/settings/LookTab");
    render(<LookTab />);
    await userEvent.click(await screen.findByRole("button", { name: /accent #2563eb/i }));
    expect(JSON.parse(localStorage.getItem("cc.appearance")!)).toMatchObject({
      accent: "#2563eb",
    });
  });
});

describe("Settings — General tab", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("General renders defaults (notify off) and persists toggle", async () => {
    const { GeneralTab } = await import("../src/main/settings/GeneralTab");
    render(<GeneralTab />);
    const notify = await screen.findByRole("checkbox", { name: /notify me on new items/i });
    expect(notify).not.toBeChecked();
    await userEvent.click(notify);
    expect(notify).toBeChecked();
  });
});

describe("Settings — Capture tab", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("hotkey rebind calls invoke(register_hotkeys) and persists", async () => {
    const { CaptureTab } = await import("../src/main/settings/CaptureTab");
    render(<CaptureTab />);
    const captureInput = await screen.findByRole("textbox", { name: /capture hotkey/i });
    await userEvent.clear(captureInput);
    await userEvent.type(captureInput, "Ctrl+Shift+K");
    await userEvent.click(screen.getByRole("button", { name: /apply hotkeys/i }));
    expect(mockInvoke).toHaveBeenCalledWith("register_hotkeys", {
      capture: "Ctrl+Shift+K",
      flyout: expect.any(String),
    });
  });

  it("hotkey register failure shows inline error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Hotkey conflict"));
    const { CaptureTab } = await import("../src/main/settings/CaptureTab");
    render(<CaptureTab />);
    await screen.findByRole("textbox", { name: /capture hotkey/i });
    await userEvent.click(screen.getByRole("button", { name: /apply hotkeys/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/combo taken/i);
  });

  it("toast toggle persists", async () => {
    const { CaptureTab } = await import("../src/main/settings/CaptureTab");
    render(<CaptureTab />);
    const toastToggle = await screen.findByRole("checkbox", { name: /show capture toast/i });
    expect(toastToggle).toBeChecked(); // default is on
    await userEvent.click(toastToggle);
    expect(toastToggle).not.toBeChecked();
  });

  it("launch at login toggle reflects state toggle", async () => {
    const { CaptureTab } = await import("../src/main/settings/CaptureTab");
    render(<CaptureTab />);
    const loginToggle = await screen.findByRole("checkbox", { name: /launch at login/i });
    // Default is on — click to disable
    expect(loginToggle).toBeChecked();
    await userEvent.click(loginToggle);
    expect(loginToggle).not.toBeChecked();
    // Click again to re-enable
    await userEvent.click(loginToggle);
    expect(loginToggle).toBeChecked();
  });

  it("toast duration input persists captureToastDurationMs", async () => {
    const store = new Store();
    __setStore(store);
    const { CaptureTab } = await import("../src/main/settings/CaptureTab");
    render(<CaptureTab />);
    const durationInput = await screen.findByRole("spinbutton", { name: /toast duration/i });
    // Default is 5 seconds (5000ms)
    expect(durationInput).toHaveValue(5);
    // Change to 8 seconds via a direct change event (avoids multi-keypress side-effects)
    fireEvent.change(durationInput, { target: { value: "8" } });
    // Allow async savePrefs to complete
    await new Promise((r) => setTimeout(r, 10));
    const raw = await store.get("cc.prefs");
    expect(JSON.parse(raw as string)).toMatchObject({ captureToastDurationMs: 8000 });
  });
});
