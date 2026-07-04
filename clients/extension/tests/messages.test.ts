import { describe, expect, it } from "vitest";
import { isPopupRequest, isWorkerEvent } from "../src/shared/messages";

describe("popup→worker message guard", () => {
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
      { type: "retry" },
      { type: "rename_device", deviceId: "d" },
    ];
    for (const msg of bad) expect(isPopupRequest(msg)).toBe(false);
  });
});

describe("worker→popup event guard", () => {
  it("accepts every event shape and rejects junk", () => {
    expect(isWorkerEvent({ type: "status", status: "live" })).toBe(true);
    expect(isWorkerEvent({ type: "item_deleted", itemId: "01X" })).toBe(true);
    expect(isWorkerEvent({ type: "auth_required" })).toBe(true);
    expect(isWorkerEvent({ type: "status" })).toBe(false);
    expect(isWorkerEvent({ type: "nope" })).toBe(false);
  });
});
