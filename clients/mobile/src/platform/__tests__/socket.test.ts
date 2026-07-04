import { makeRnSocketFactory, wsUrl } from "../socket";
import type { WsLike } from "@crossclipper/core";

// ---------------------------------------------------------------------------
// Fake WebSocket constructor for injection
// ---------------------------------------------------------------------------
class FakeWS {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  constructor(public url: string) {}
}

// ---------------------------------------------------------------------------
// wsUrl helper
// ---------------------------------------------------------------------------
describe("wsUrl", () => {
  it("converts http to ws", () => {
    expect(wsUrl("http://localhost:8000", "tok")).toBe(
      "ws://localhost:8000/api/v1/ws?token=tok",
    );
  });

  it("converts https to wss", () => {
    expect(wsUrl("https://example.com", "tok")).toBe(
      "wss://example.com/api/v1/ws?token=tok",
    );
  });

  it("strips trailing slash from baseUrl", () => {
    expect(wsUrl("http://localhost:8000/", "tok")).toBe(
      "ws://localhost:8000/api/v1/ws?token=tok",
    );
  });

  it("percent-encodes the token", () => {
    expect(wsUrl("http://localhost:8000", "a b+c")).toBe(
      "ws://localhost:8000/api/v1/ws?token=a%20b%2Bc",
    );
  });
});

// ---------------------------------------------------------------------------
// makeRnSocketFactory / rnSocketFactory
// ---------------------------------------------------------------------------
describe("makeRnSocketFactory", () => {
  let inst: FakeWS;
  let factory: ReturnType<typeof makeRnSocketFactory>;

  beforeEach(() => {
    inst = undefined as unknown as FakeWS;
    // Wrap FakeWS in a subclass so we can capture the instance while keeping
    // the constructor signature that WsCtor requires.
    class CapturingFakeWS extends FakeWS {
      constructor(url: string) {
        super(url);
        inst = this;
      }
    }
    factory = makeRnSocketFactory(CapturingFakeWS as unknown as typeof WebSocket);
  });

  it("adapts RN WebSocket to WsLike (plan specimen verbatim)", () => {
    // Mirrors the exact test pattern from the plan (Task 2, TDD step 1).
    // Uses the beforeEach factory which captures `inst`.
    const like = factory("ws://x/api/v1/ws?token=t");
    const got: unknown[] = [];
    like.onmessage = (d) => got.push(d);
    inst.onmessage?.({ data: '{"type":"pong"}' });
    expect(got).toEqual(['{"type":"pong"}']);
    like.send("hi");
    expect(inst.send).toHaveBeenCalledWith("hi");
  });

  it("returns a WsLike object", () => {
    const like = factory("ws://localhost/api/v1/ws?token=t");
    expect(like).toHaveProperty("send");
    expect(like).toHaveProperty("close");
    expect(like.onopen).toBeNull();
    expect(like.onmessage).toBeNull();
    expect(like.onclose).toBeNull();
  });

  it("opens the WebSocket at the given URL", () => {
    factory("ws://host/api/v1/ws?token=abc");
    expect(inst.url).toBe("ws://host/api/v1/ws?token=abc");
  });

  it("fires onopen when underlying socket opens", () => {
    const like = factory("ws://host/");
    const opened = jest.fn();
    like.onopen = opened;
    inst.onopen?.();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("fires onmessage with string data when underlying socket receives a message", () => {
    const like = factory("ws://host/");
    const received: unknown[] = [];
    like.onmessage = (d) => received.push(d);
    inst.onmessage?.({ data: '{"type":"pong"}' });
    expect(received).toEqual(['{"type":"pong"}']);
  });

  it("coerces non-string data to string via String()", () => {
    const like = factory("ws://host/");
    const received: unknown[] = [];
    like.onmessage = (d) => received.push(d);
    inst.onmessage?.({ data: 42 });
    expect(received).toEqual(["42"]);
  });

  it("fires onclose when underlying socket closes", () => {
    const like = factory("ws://host/");
    const closed = jest.fn();
    like.onclose = closed;
    inst.onclose?.();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("delegates send to underlying socket", () => {
    const like = factory("ws://host/");
    like.send("hello");
    expect(inst.send).toHaveBeenCalledWith("hello");
  });

  it("delegates close to underlying socket", () => {
    const like = factory("ws://host/");
    like.close();
    expect(inst.close).toHaveBeenCalledTimes(1);
  });

  it("does not fire onmessage if handler is null", () => {
    const like = factory("ws://host/");
    // should not throw
    expect(() => inst.onmessage?.({ data: "test" })).not.toThrow();
  });

  it("does not fire onopen if handler is null", () => {
    const like = factory("ws://host/");
    expect(() => inst.onopen?.()).not.toThrow();
  });

  it("does not fire onclose if handler is null", () => {
    const like = factory("ws://host/");
    expect(() => inst.onclose?.()).not.toThrow();
  });
});

// Verify the exported default constant satisfies SocketFactory type at compile time
import { rnSocketFactory } from "../socket";
import type { SocketFactory } from "@crossclipper/core";

const _typeCheck: SocketFactory = rnSocketFactory;
void _typeCheck;
