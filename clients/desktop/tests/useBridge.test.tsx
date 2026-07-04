import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEvents, emit } from "./tauriMock";
import { useBridge, reduce } from "../src/main/useBridge";
import type { Item } from "@crossclipper/core";

// Re-export from tauriMock so the bridge's listen/emit are intercepted.
// The vitest alias maps @tauri-apps/api/event → ./tauriMock.

const item = (id: string): Item =>
  ({
    id,
    kind: "text",
    body: `body-${id}`,
    origin_device_id: "d1",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T11:00:00",
    deleted_at: null,
  }) as Item;

const snapshot = {
  authed: true,
  baseUrl: "http://s",
  deviceId: "self",
  status: "live" as const,
  items: [item("01B"), item("01A")],
  pending: [],
  devices: [],
};

describe("reduce", () => {
  it("inserts live items in ULID order without duplicates", () => {
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "item", item: item("01C") });
    s = reduce(s, { type: "item", item: item("01C") });
    expect(s.items.map((i) => i.id)).toEqual(["01C", "01B", "01A"]);
    s = reduce(s, { type: "item_deleted", itemId: "01B" });
    expect(s.items.map((i) => i.id)).toEqual(["01C", "01A"]);
  });

  it("auth_required flips the flag", () => {
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "auth_required" });
    expect(s.authRequired).toBe(true);
  });

  it("status event updates status field", () => {
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "status", status: "syncing" });
    expect(s.status).toBe("syncing");
  });

  it("outbox_changed replaces pending", () => {
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    const pending = [{ id: "01X", kind: "text" as const, body: "hi", targetDeviceId: null, failed: false }];
    s = reduce(s, { type: "outbox_changed", pending });
    expect(s.pending).toEqual(pending);
  });

  it("devices event replaces devices", () => {
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    const devices = [{ id: "d1", name: "Phone", platform: "android", online: true, isSelf: false, lastSeenAt: "now" }];
    s = reduce(s, { type: "devices", devices: devices as never });
    expect(s.devices).toEqual(devices);
  });
});

describe("useBridge", () => {
  beforeEach(() => __resetEvents());

  it("starts in not-ready state", () => {
    const { result } = renderHook(() => useBridge());
    expect(result.current.state.ready).toBe(false);
  });

  it("applies snapshot event → ready = true", async () => {
    const { result } = renderHook(() => useBridge());
    await act(async () => {
      await emit("cc:evt", { type: "snapshot", state: snapshot });
    });
    expect(result.current.state.ready).toBe(true);
    expect(result.current.state.items).toHaveLength(2);
  });

  it("api.send RPC shape is correct", async () => {
    const servedReqs: unknown[] = [];
    // Serve requests via tauriMock's cc:req channel.
    const { listen: mockListen, emit: mockEmit } = await import("./tauriMock");
    await mockListen("cc:req", async ({ payload }) => {
      const p = payload as { id: string; req: unknown };
      servedReqs.push(p.req);
      await mockEmit("cc:reply", { id: p.id, result: { outboxId: "01X" } });
    });

    const { result } = renderHook(() => useBridge());
    await act(async () => {
      await result.current.api.send("text", "hi", "d2");
    });
    expect(servedReqs[0]).toEqual({ type: "send", kind: "text", body: "hi", targetDeviceId: "d2" });
  });

  it("ignores unknown event types without throwing", async () => {
    const { result } = renderHook(() => useBridge());
    await act(async () => {
      await emit("cc:evt", { type: "unknown_future_event" });
    });
    expect(result.current.state.ready).toBe(false);
  });
});
