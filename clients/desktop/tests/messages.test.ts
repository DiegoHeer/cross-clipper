import { describe, expect, it } from "vitest";
import { isPopupRequest, isWorkerEvent } from "../src/shared/messages";

describe("popup→background request guard", () => {
  it("accepts every request shape", () => {
    const good = [
      { type: "get_state" },
      { type: "refresh" },
      { type: "send", kind: "text", body: "x", targetDeviceId: null },
      { type: "send", kind: "link", body: "https://x", targetDeviceId: "d2" },
      { type: "retry", outboxId: "01X" },
      { type: "delete_item", itemId: "01X" },
      { type: "rename_device", deviceId: "d", name: "n" },
      { type: "revoke_device", deviceId: "d" },
      { type: "sign_out" },
      { type: "undo_capture", outboxId: "01Y" },
    ];
    for (const msg of good) expect(isPopupRequest(msg)).toBe(true);
  });

  it("rejects malformed shapes", () => {
    const bad = [
      null,
      "get_state",
      { type: "unknown" },
      { type: "send", kind: "blob", body: "x", targetDeviceId: null },
      { type: "send", kind: "text" }, // missing body
      { type: "retry" }, // missing outboxId
      { type: "rename_device", deviceId: "d" }, // missing name
      { type: "undo_capture" }, // missing outboxId
    ];
    for (const msg of bad) expect(isPopupRequest(msg)).toBe(false);
  });
});

describe("background→renderer event guard", () => {
  it("accepts every event shape", () => {
    const good = [
      { type: "snapshot", state: {} },
      { type: "item", item: {} },
      { type: "item_deleted", itemId: "01X" },
      { type: "status", status: "live" },
      { type: "outbox_changed", pending: [] },
      { type: "devices", devices: [] },
      { type: "auth_required" },
      { type: "toast_update", outboxId: "01X", state: "synced" },
    ];
    for (const msg of good) expect(isWorkerEvent(msg)).toBe(true);
  });

  it("rejects junk", () => {
    expect(isWorkerEvent({ type: "status" })).toBe(false); // missing status value
    expect(isWorkerEvent({ type: "nope" })).toBe(false);
    expect(isWorkerEvent({ type: "capture_result" })).toBe(false); // vestigial — no longer a WorkerEvent
    expect(isWorkerEvent({ type: "toast_update", outboxId: "x" })).toBe(false); // missing state
    expect(isWorkerEvent(null)).toBe(false);
  });
});
