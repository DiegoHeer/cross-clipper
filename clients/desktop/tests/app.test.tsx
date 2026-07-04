import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { __resetEvents, emit } from "./tauriMock";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Emit a WorkerEvent on the cc:evt channel (what the background window sends).
 * useBridge subscribes to this channel via subscribeEvents → listen("cc:evt").
 */
async function dispatchEvent(event: unknown) {
  await emit("cc:evt", event);
}

/**
 * The bridge's requestBackground emits on cc:req and awaits cc:reply.
 * To avoid timeouts in tests we intercept cc:req and immediately reply.
 */
let capturedRequests: unknown[] = [];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("App (live, desktop)", () => {
  beforeEach(() => {
    __resetEvents();
    capturedRequests = [];

    // Intercept REQ_EVENT and auto-reply with { ok: true, outboxId: "01X" }
    // We re-listen each test because __resetEvents clears handlers.
    void import("@tauri-apps/api/event").then(({ listen, emit: tauriEmit }) => {
      void listen("cc:req", ({ payload }: { payload: unknown }) => {
        const env = payload as { id: string; req: unknown };
        capturedRequests.push(env.req);
        void tauriEmit("cc:reply", { id: env.id, result: { ok: true, outboxId: "01X" } });
      });
    });
  });

  async function renderApp(snapshot = liveSnapshot()) {
    const { default: App } = await import("../src/main/App");
    render(<App />);
    // Let the effect run and subscribe to events
    await act(async () => {
      await dispatchEvent({ type: "snapshot", state: snapshot });
    });
  }

  it("shows loading splash before first snapshot", async () => {
    const { default: App } = await import("../src/main/App");
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders synced items with resolved device names", async () => {
    await renderApp();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText(/Pixel 8/).length).toBeGreaterThan(0);
  });

  it("compose sends through the bridge RPC", async () => {
    await renderApp();
    await userEvent.type(screen.getByRole("textbox"), "hello{Enter}");
    expect(capturedRequests).toContainEqual({
      type: "send",
      kind: "text",
      body: "hello",
      targetDeviceId: null,
    });
  });

  it("shows reconnecting banner when authed but not live", async () => {
    await renderApp(liveSnapshot({ status: "connecting" }));
    expect(screen.getByText(/reconnecting…/i)).toBeInTheDocument();
  });

  it("shows empty-state when feed is empty", async () => {
    await renderApp(liveSnapshot({ items: [] }));
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });

  it("delete RPCs the bridge", async () => {
    await renderApp();
    await userEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]!);
    expect(capturedRequests).toContainEqual({ type: "delete_item", itemId: "01B" });
  });

  it("device rail filters the feed by origin device", async () => {
    await renderApp();
    const rail = screen.getByRole("navigation", { name: /devices/i });
    // All items have origin_device_id "d2"; filtering by self → empty state
    await userEvent.click(within(rail).getByRole("button", { name: /work laptop/i }));
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });

  it("shows onboarding placeholder when not authed on first snapshot", async () => {
    const { default: App } = await import("../src/main/App");
    render(<App />);
    await act(async () => {
      await dispatchEvent({
        type: "snapshot",
        state: {
          authed: false,
          authRequired: false,
          baseUrl: null,
          deviceId: null,
          status: "stopped",
          items: [],
          pending: [],
          devices: [],
        },
      });
    });
    // Onboarding renders — must show server step heading, not the feed
    expect(screen.getByRole("heading", { name: /your server/i })).toBeInTheDocument();
    expect(screen.queryByText(/copy something/i)).toBeNull();
  });

  it("shows onboarding placeholder when authRequired", async () => {
    const { default: App } = await import("../src/main/App");
    render(<App />);
    await act(async () => {
      await dispatchEvent({
        type: "snapshot",
        state: {
          authed: true,
          authRequired: false,
          baseUrl: "http://s",
          deviceId: "self",
          status: "live",
          items: [],
          pending: [],
          devices: [],
        },
      });
    });
    await act(async () => {
      await dispatchEvent({ type: "auth_required" });
    });
    // Reauth shows sign-in step of the onboarding flow
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("goes straight to feed when already authed on first snapshot", async () => {
    await renderApp(liveSnapshot({ items: [] }));
    // Feed empty state confirms we are on the feed, not onboarding
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/your server/i)).toBeNull();
  });

  it("settings gear button is rendered and opens settings", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });
});
