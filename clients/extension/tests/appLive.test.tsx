import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { makeFakeBrowser, type FakePort } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";

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
    platform: "extension",
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

describe("App (live)", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  let port: FakePort | null;
  let rpcs: unknown[];

  beforeEach(() => {
    fake = makeFakeBrowser();
    port = null;
    rpcs = [];
    (fake.browser.runtime as Record<string, unknown>).connect = ({ name }: { name: string }) => {
      port = fake.makePort(name);
      return port;
    };
    fake.browser.runtime.onMessage.addListener((msg: unknown) => {
      rpcs.push(msg);
      return Promise.resolve({ ok: true, outboxId: "01X" });
    });
    setFakeBrowser(fake.browser);
  });

  async function renderLive(snapshot = liveSnapshot()) {
    const { default: App } = await import("../src/popup/App");
    render(<App />);
    act(() => {
      port!.onMessage.emit({ type: "snapshot", state: snapshot });
    });
  }

  it("renders synced items with resolved device names", async () => {
    await renderLive();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText(/Pixel 8/).length).toBeGreaterThan(0);
  });

  it("compose sends through the worker RPC", async () => {
    await renderLive();
    await userEvent.type(screen.getByRole("textbox"), "hello{Enter}");
    expect(rpcs).toContainEqual({ type: "send", kind: "text", body: "hello", targetDeviceId: null });
  });

  it("pending sends render as sending cards; failed ones offer retry", async () => {
    await renderLive(
      liveSnapshot({
        pending: [
          { id: "01P", kind: "text", body: "queued", targetDeviceId: null, failed: false },
          { id: "01F", kind: "text", body: "broken", targetDeviceId: null, failed: true },
        ],
      }),
    );
    expect(screen.getByText(/sending…/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /not sent — tap to retry/i }));
    expect(rpcs).toContainEqual({ type: "retry", outboxId: "01F" });
  });

  it("shows the reconnecting banner when not live", async () => {
    await renderLive(liveSnapshot({ status: "connecting" }));
    expect(screen.getByText(/reconnecting…/i)).toBeInTheDocument();
  });

  it("delete RPCs the worker", async () => {
    await renderLive();
    await userEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]!);
    expect(rpcs).toContainEqual({ type: "delete_item", itemId: "01B" });
  });

  it("live items arriving while scrolled show the new-items pill", async () => {
    await renderLive();
    const feed = document.querySelector(".feed")!;
    Object.defineProperty(feed, "scrollTop", { value: 200, writable: true });
    feed.dispatchEvent(new Event("scroll"));
    act(() => {
      port!.onMessage.emit({ type: "item", item: item("01C") });
    });
    expect(await screen.findByRole("button", { name: /new item/i })).toBeInTheDocument();
  });

  it("target picker shows non-self device chips", async () => {
    await renderLive();
    const picker = screen.getByRole("group", { name: /notify device/i });
    expect(within(picker).getByRole("button", { name: /pixel 8/i })).toBeInTheDocument();
  });

  it("rail selection filters the feed by origin device", async () => {
    await renderLive();
    const rail = screen.getByRole("navigation", { name: /devices/i });
    const before = screen.getAllByRole("article").length;
    await userEvent.click(within(rail).getByRole("button", { name: /pixel 8/i }));
    // All items have origin_device_id "d2" — filter by d2 should keep same count
    // (all items from Pixel 8 in fixture); clicking "Work laptop" (self) would show empty
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    // Filter by self (Work laptop) — no items from self in liveSnapshot → empty state
    await userEvent.click(within(rail).getByRole("button", { name: /work laptop/i }));
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });

  it("shows the empty-state hint when the filter matches nothing", async () => {
    await renderLive();
    const rail = screen.getByRole("navigation", { name: /devices/i });
    await userEvent.click(within(rail).getByRole("button", { name: /work laptop/i }));
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });
});
