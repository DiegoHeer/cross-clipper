/**
 * Tests for probeServer() — TDD step 1 (Task 10) + review fixes (finding 3).
 *
 * probeServer() now accepts an injectable fetchFn so tests stay pure and don't
 * rely on globalThis.fetch spying.
 */
import { probeServer, isInsecureHttp, normalizeServerUrl, semverGte, MIN_SERVER_VERSION } from "../probe";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a jest mock fetchFn that returns the given status + JSON body. */
function makeFetchFn(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

/** Build a jest mock fetchFn that rejects with a network error. */
function makeNetworkErrorFn(): jest.Mock {
  return jest.fn().mockRejectedValue(new Error("Network request failed"));
}

// ─── normalizeServerUrl ──────────────────────────────────────────────────────

describe("normalizeServerUrl", () => {
  it("returns null for empty string", () => {
    expect(normalizeServerUrl("")).toBeNull();
  });

  it("adds https:// if no scheme", () => {
    expect(normalizeServerUrl("clip.example.com")).toBe("https://clip.example.com");
  });

  it("strips trailing slash", () => {
    expect(normalizeServerUrl("https://clip.example.com/")).toBe(
      "https://clip.example.com",
    );
  });

  it("preserves http:// scheme", () => {
    expect(normalizeServerUrl("http://localhost:8000")).toBe("http://localhost:8000");
  });
});

// ─── isInsecureHttp ──────────────────────────────────────────────────────────

describe("isInsecureHttp", () => {
  it("returns false for https://", () => {
    expect(isInsecureHttp("https://example.com")).toBe(false);
  });

  it("returns false for http://localhost", () => {
    expect(isInsecureHttp("http://localhost")).toBe(false);
  });

  it("returns false for http://127.0.0.1", () => {
    expect(isInsecureHttp("http://127.0.0.1:8000")).toBe(false);
  });

  it("returns false for http://10.0.0.1 (LAN)", () => {
    // LAN addresses are allowed by the extension; same here
    expect(isInsecureHttp("http://10.0.0.1")).toBe(false);
  });

  it("returns true for plain http:// to external host", () => {
    expect(isInsecureHttp("http://example.com")).toBe(true);
  });
});

// ─── semverGte ───────────────────────────────────────────────────────────────

describe("semverGte", () => {
  it("returns true when versions are equal", () => {
    expect(semverGte("0.1.0", "0.1.0")).toBe(true);
  });

  it("returns true when a is newer (patch)", () => {
    expect(semverGte("0.1.1", "0.1.0")).toBe(true);
  });

  it("returns true when a is newer (minor)", () => {
    expect(semverGte("0.2.0", "0.1.0")).toBe(true);
  });

  it("returns false when a is older (patch)", () => {
    expect(semverGte("0.0.9", "0.1.0")).toBe(false);
  });
});

// ─── probeServer ─────────────────────────────────────────────────────────────

describe("probeServer", () => {
  const URL = "https://clip.example.com";

  it("classifies a healthy CrossClipper server as ok", async () => {
    const fetchFn = makeFetchFn(200, {
      app: "crossclipper",
      status: "ok",
      version: "0.1.0",
      registration_open: false,
    });
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: true, version: "0.1.0", registrationOpen: false });
  });

  it("classifies a server with registration_open:true", async () => {
    const fetchFn = makeFetchFn(200, {
      app: "crossclipper",
      status: "ok",
      version: "0.2.0",
      registration_open: true,
    });
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: true, version: "0.2.0", registrationOpen: true });
  });

  it("returns not_crossclipper when app field is not 'crossclipper' (foreign server returning ok status)", async () => {
    // A foreign server that happens to return {status:"ok"} must NOT pass
    const fetchFn = makeFetchFn(200, {
      app: "someotherapp",
      status: "ok",
      version: "1.0.0",
      registration_open: false,
    });
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: false, reason: "not_crossclipper" });
  });

  it("returns server_too_old when version is below MIN_SERVER_VERSION", async () => {
    // MIN_SERVER_VERSION is "0.1.0"; a server reporting "0.0.9" is too old
    const fetchFn = makeFetchFn(200, {
      app: "crossclipper",
      status: "ok",
      version: "0.0.9",
      registration_open: false,
    });
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: false, reason: "server_too_old" });
  });

  it("MIN_SERVER_VERSION itself is accepted (boundary)", async () => {
    const fetchFn = makeFetchFn(200, {
      app: "crossclipper",
      status: "ok",
      version: MIN_SERVER_VERSION,
      registration_open: false,
    });
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: true, version: MIN_SERVER_VERSION, registrationOpen: false });
  });

  it("returns not_crossclipper for non-JSON response", async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("<html>not json</html>"),
    } as unknown as Response);
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: false, reason: "not_crossclipper" });
  });

  it("returns unhealthy for 503 status", async () => {
    const fetchFn = makeFetchFn(503, { detail: "Service Unavailable" });
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: false, reason: "unhealthy" });
  });

  it("returns unreachable when fetch throws (network error)", async () => {
    const fetchFn = makeNetworkErrorFn();
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("returns not_crossclipper for non-2xx non-503 status (server reachable but wrong endpoint)", async () => {
    // ApiClient throws ApiError for non-503 non-2xx; extension probe maps this to not_crossclipper
    const fetchFn = makeFetchFn(404, {});
    const result = await probeServer(URL, fetchFn);
    expect(result).toEqual({ ok: false, reason: "not_crossclipper" });
  });
});
