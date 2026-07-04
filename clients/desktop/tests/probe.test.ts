import { describe, expect, it } from "vitest";
import {
  isInsecureHttp,
  normalizeServerUrl,
  probeServer,
  semverGte,
} from "../src/main/onboarding/probe";

describe("normalizeServerUrl", () => {
  it("adds https:// to schemeless input and strips trailing slash", () => {
    expect(normalizeServerUrl("clip.example.com")).toBe("https://clip.example.com");
    expect(normalizeServerUrl("http://192.168.1.10:8080/")).toBe("http://192.168.1.10:8080");
    expect(normalizeServerUrl("not a url at all")).toBeNull();
  });
});

describe("isInsecureHttp", () => {
  it("flags public plain http, allows localhost and private ranges", () => {
    expect(isInsecureHttp("http://clip.example.com")).toBe(true);
    expect(isInsecureHttp("https://clip.example.com")).toBe(false);
    expect(isInsecureHttp("http://localhost:8080")).toBe(false);
    expect(isInsecureHttp("http://127.0.0.1:8080")).toBe(false);
    expect(isInsecureHttp("http://192.168.1.10:8080")).toBe(false);
    expect(isInsecureHttp("http://10.0.0.1")).toBe(false);
  });
});

describe("semverGte", () => {
  it("compares semver strings correctly", () => {
    expect(semverGte("0.1.0", "0.1.0")).toBe(true);
    expect(semverGte("0.2.0", "0.1.0")).toBe(true);
    expect(semverGte("0.0.9", "0.1.0")).toBe(false);
    expect(semverGte("1.0.0", "0.9.9")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// probeServer
// ---------------------------------------------------------------------------

const healthOk = { code: "ok", version: "0.1.0", registration_open: false };

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status }),
    )) as unknown as typeof fetch;
}

describe("probeServer", () => {
  it("returns ok result for a valid healthy server", async () => {
    expect(
      await probeServer("http://s", fetchReturning(healthOk)),
    ).toEqual({ ok: true, version: "0.1.0", registrationOpen: false });
  });

  it("passes registrationOpen through", async () => {
    expect(
      await probeServer("http://s", fetchReturning({ ...healthOk, registration_open: true })),
    ).toEqual({ ok: true, version: "0.1.0", registrationOpen: true });
  });

  it("returns error reasons for failure cases", async () => {
    expect(await probeServer("http://s", () => Promise.reject(new Error("net")))).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(
      await probeServer("http://s", fetchReturning({ code: "unhealthy", message: "db" }, 503)),
    ).toEqual({ ok: false, reason: "unhealthy" });
    expect(await probeServer("http://s", fetchReturning({ hello: "world" }))).toEqual({
      ok: false,
      reason: "not_crossclipper",
    });
  });

  it("rejects servers older than MIN_SERVER_VERSION", async () => {
    expect(
      await probeServer("http://s", fetchReturning({ ...healthOk, version: "0.0.1" })),
    ).toEqual({ ok: false, reason: "server_too_old" });
  });
});
