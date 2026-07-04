/**
 * Tests for probeServer() — TDD step 1 (Task 10).
 */
import { probeServer, isInsecureHttp, normalizeServerUrl } from "../probe";

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown): jest.SpyInstance {
  return jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

afterEach(() => jest.restoreAllMocks());

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

// ─── probeServer ─────────────────────────────────────────────────────────────

describe("probeServer", () => {
  it("classifies a healthy CrossClipper server as ok", async () => {
    mockFetch(200, {
      status: "ok",
      version: "0.1.0",
      registration_open: false,
    });
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: true, version: "0.1.0", registrationOpen: false });
  });

  it("classifies a server with registration_open:true", async () => {
    mockFetch(200, {
      status: "ok",
      version: "0.2.0",
      registration_open: true,
    });
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: true, version: "0.2.0", registrationOpen: true });
  });

  it("returns not_crossclipper for non-JSON response", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("<html>not json</html>"),
    } as unknown as Response);
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: false, reason: "not_crossclipper" });
  });

  it("returns not_crossclipper when status field is absent", async () => {
    mockFetch(200, { version: "0.1.0" });
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: false, reason: "not_crossclipper" });
  });

  it("returns unhealthy when status is not 'ok'", async () => {
    mockFetch(200, { status: "degraded", version: "0.1.0" });
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: false, reason: "unhealthy" });
  });

  it("returns unreachable when fetch throws (network error)", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network request failed"));
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("returns unreachable for non-2xx status", async () => {
    mockFetch(503, {});
    const result = await probeServer("https://clip.example.com");
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });
});
