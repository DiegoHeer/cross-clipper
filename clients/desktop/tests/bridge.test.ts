import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEvents } from "./tauriMock";
import {
  broadcast,
  requestBackground,
  serveRequests,
  subscribeEvents,
} from "../src/shared/bridge";
import type { PopupRequest } from "../src/shared/messages";

describe("event bridge", () => {
  beforeEach(() => __resetEvents());

  it("delivers broadcast WorkerEvents to subscribers", async () => {
    const seen: unknown[] = [];
    await subscribeEvents((e) => seen.push(e));
    await broadcast({ type: "status", status: "live" });
    expect(seen).toEqual([{ type: "status", status: "live" }]);
  });

  it("request/reply round-trips through the handler with correlation", async () => {
    const handler = vi.fn(async (req: PopupRequest) =>
      req.type === "send" ? { outboxId: "01X" } : { ok: true },
    );
    await serveRequests(handler);
    const res = await requestBackground<{ outboxId: string }>({
      type: "send",
      kind: "text",
      body: "hi",
      targetDeviceId: null,
    });
    expect(res.outboxId).toBe("01X");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed WorkerEvents", async () => {
    const seen: unknown[] = [];
    await subscribeEvents((e) => seen.push(e));
    await broadcast({ type: "nonsense" } as never);
    expect(seen).toEqual([]);
  });

  it("multiple subscribers all receive the broadcast", async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    await subscribeEvents((e) => a.push(e));
    await subscribeEvents((e) => b.push(e));
    await broadcast({ type: "auth_required" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("unsubscribe stops further delivery", async () => {
    const seen: unknown[] = [];
    const unsub = await subscribeEvents((e) => seen.push(e));
    await broadcast({ type: "status", status: "live" });
    unsub();
    await broadcast({ type: "status", status: "connecting" });
    expect(seen).toHaveLength(1);
  });
});
