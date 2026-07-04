import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { __resetEvents, emit } from "./tauriMock";
import * as clipboardPlugin from "@tauri-apps/plugin-clipboard-manager";
import * as openerPlugin from "@tauri-apps/plugin-opener";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    kind: "text",
    body: `body ${id}`,
    origin_device_id: "d2",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

const devices = [
  {
    id: "self",
    name: "Work laptop",
    platform: "windows",
    online: true,
    last_seen_at: "2026-07-03T11:59:30",
    created_at: "2026-07-01T00:00:00",
  },
  {
    id: "d2",
    name: "Pixel 8",
    platform: "android",
    online: true,
    last_seen_at: "2026-07-03T11:59:00",
    created_at: "2026-07-01T00:00:00",
  },
];

const liveSnapshot = (over: Record<string, unknown> = {}) => ({
  authed: true,
  baseUrl: "http://s",
  deviceId: "self",
  status: "live",
  items: [item("01B"), item("01A")],
  pending: [],
  devices,
  ...over,
});

async function dispatchEvent(event: unknown) {
  await emit("cc:evt", event);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Flyout", () => {
  beforeEach(() => {
    __resetEvents();
  });

  async function renderFlyout(snapshot = liveSnapshot()) {
    const { Flyout } = await import("../src/flyout/Flyout");
    render(<Flyout />);
    await act(async () => {
      await dispatchEvent({ type: "snapshot", state: snapshot });
    });
  }

  it("shows loading splash before first snapshot", async () => {
    const { Flyout } = await import("../src/flyout/Flyout");
    render(<Flyout />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders last 5 items from snapshot", async () => {
    await renderFlyout(liveSnapshot({ items: [item("01A"), item("01B")] }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("copy button routes through the clipboard-manager plugin mock", async () => {
    const writeSpy = vi.spyOn(clipboardPlugin, "writeText");
    await renderFlyout(liveSnapshot({ items: [item("01A")] }));
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeSpy).toHaveBeenCalledWith("body 01A");
    writeSpy.mockRestore();
  });

  it("open action on a link item routes through the opener plugin", async () => {
    const openSpy = vi.spyOn(openerPlugin, "openUrl");
    const linkItem = item("02A", { kind: "link", body: "https://example.com" });
    await renderFlyout(liveSnapshot({ items: [linkItem] }));
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(openSpy).toHaveBeenCalledWith("https://example.com");
    openSpy.mockRestore();
  });
});
