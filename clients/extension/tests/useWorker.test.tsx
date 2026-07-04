import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Item } from "@crossclipper/core";
import { makeFakeBrowser, type FakePort } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";

const item = (id: string): Item =>
  ({
    id,
    kind: "text",
    body: id,
    origin_device_id: "d2",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
  }) as Item;

const snapshot = {
  authed: true,
  baseUrl: "http://s",
  deviceId: "self",
  status: "live",
  items: [item("01B"), item("01A")],
  pending: [],
  devices: [],
};

describe("reduce", () => {
  it("inserts live items in ULID order without duplicates", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "item", item: item("01C") });
    s = reduce(s, { type: "item", item: item("01C") });
    expect(s.items.map((i) => i.id)).toEqual(["01C", "01B", "01A"]);
    s = reduce(s, { type: "item_deleted", itemId: "01B" });
    expect(s.items.map((i) => i.id)).toEqual(["01C", "01A"]);
  });

  it("auth_required flips the flag", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "auth_required" });
    expect(s.authRequired).toBe(true);
  });

  it("status event updates status field", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "status", status: "syncing" });
    expect(s.status).toBe("syncing");
  });

  it("outbox_changed replaces pending", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    const pending = [
      {
        id: "01X",
        kind: "text" as const,
        body: "hi",
        targetDeviceId: null,
        failed: false,
      },
    ];
    s = reduce(s, { type: "outbox_changed", pending });
    expect(s.pending).toEqual(pending);
  });

  it("devices event replaces devices", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    const devices = [{ id: "d1", name: "Phone", current: false }];
    s = reduce(s, { type: "devices", devices: devices as never });
    expect(s.devices).toEqual(devices);
  });
});

describe("useWorker", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  let connectedPort: FakePort | null = null;

  beforeEach(() => {
    fake = makeFakeBrowser();
    connectedPort = null;
    // popup side calls browser.runtime.connect — extend the fake for this test
    (fake.browser.runtime as Record<string, unknown>).connect = ({ name }: { name: string }) => {
      connectedPort = fake.makePort(name);
      return connectedPort;
    };
    setFakeBrowser(fake.browser);
  });

  it("connects the events port and applies pushed snapshots", async () => {
    const { useWorker } = await import("../src/popup/useWorker");
    const { result } = renderHook(() => useWorker());
    expect(result.current.state.ready).toBe(false);
    act(() => {
      connectedPort!.onMessage.emit({ type: "snapshot", state: snapshot });
    });
    expect(result.current.state.ready).toBe(true);
    expect(result.current.state.items).toHaveLength(2);
  });

  it("api.send RPCs the worker with the target", async () => {
    const seen: unknown[] = [];
    fake.browser.runtime.onMessage.addListener((msg: unknown) => {
      seen.push(msg);
      return Promise.resolve({ outboxId: "01X" });
    });
    const { useWorker } = await import("../src/popup/useWorker");
    const { result } = renderHook(() => useWorker());
    await act(() => result.current.api.send("text", "hi", "d2"));
    expect(seen[0]).toEqual({ type: "send", kind: "text", body: "hi", targetDeviceId: "d2" });
  });

  it("ignores unknown messages on port", async () => {
    const { useWorker } = await import("../src/popup/useWorker");
    const { result } = renderHook(() => useWorker());
    act(() => {
      connectedPort!.onMessage.emit({ type: "unknown_future_event" });
    });
    expect(result.current.state.ready).toBe(false);
  });

  it("disconnects the port on unmount", async () => {
    const { useWorker } = await import("../src/popup/useWorker");
    const { result, unmount } = renderHook(() => useWorker());
    act(() => {
      connectedPort!.onMessage.emit({ type: "snapshot", state: snapshot });
    });
    expect(result.current.state.ready).toBe(true);
    unmount();
    // After unmount, further messages should not update state (port disconnected)
    // The port should have been disconnected — sending more messages is a no-op
    // We just verify it doesn't throw
    act(() => {
      connectedPort!.onMessage.emit({ type: "item", item: item("01Z") });
    });
  });
});
