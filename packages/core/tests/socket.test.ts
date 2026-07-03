import { afterEach, describe, expect, it, vi } from "vitest";

import { ReconnectingSocket } from "../src/sync/socket";
import { FakeSocket } from "./helpers";

describe("ReconnectingSocket", () => {
  afterEach(() => vi.useRealTimers());

  it("reconnects with exponential backoff after drops", () => {
    vi.useFakeTimers();
    const created: FakeSocket[] = [];
    const factory = () => {
      const s = new FakeSocket();
      created.push(s);
      return s;
    };
    const rs = new ReconnectingSocket(() => "ws://x", factory,
      { baseMs: 1000, maxMs: 30000, random: () => 1 }); // jitter factor 1.0
    rs.start();
    expect(created).toHaveLength(1);

    created[0]!.serverOpen();
    created[0]!.serverDrop();               // attempt 0 → delay 1000
    vi.advanceTimersByTime(999);
    expect(created).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(created).toHaveLength(2);

    created[1]!.serverDrop();               // attempt 1 (never opened) → delay 2000
    vi.advanceTimersByTime(1999);
    expect(created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(created).toHaveLength(3);

    created[2]!.serverOpen();               // success resets attempt counter
    created[2]!.serverDrop();               // → delay back to 1000
    vi.advanceTimersByTime(1000);
    expect(created).toHaveLength(4);
    rs.stop();
  });

  it("stop() prevents further reconnects and closes the socket", () => {
    vi.useFakeTimers();
    const created: FakeSocket[] = [];
    const rs = new ReconnectingSocket(() => "ws://x",
      () => { const s = new FakeSocket(); created.push(s); return s; },
      { baseMs: 10, random: () => 1 });
    rs.start();
    rs.stop();
    expect(created[0]!.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(created).toHaveLength(1);
  });

  it("JSON-parses incoming messages and exposes send", () => {
    const created: FakeSocket[] = [];
    const rs = new ReconnectingSocket(() => "ws://x",
      () => { const s = new FakeSocket(); created.push(s); return s; });
    const seen: unknown[] = [];
    rs.onMessage = (m) => seen.push(m);
    rs.start();
    created[0]!.serverOpen();
    created[0]!.serverSend({ type: "pong" });
    rs.send('{"type":"ping"}');
    expect(seen).toEqual([{ type: "pong" }]);
    expect(created[0]!.sent).toEqual(['{"type":"ping"}']);
    rs.stop();
  });
});
