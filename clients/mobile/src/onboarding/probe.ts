/**
 * probeServer — contacts a CrossClipper server's /health endpoint and
 * classifies the response. Mirrors extension popup/onboarding/probe.ts.
 */
import { ApiClient, ApiError, NetworkError } from "@crossclipper/core";
import { CLIENT_VERSION } from "../sync/SyncController";

/** Oldest server this client can talk to ("client requires newer server"). */
export const MIN_SERVER_VERSION = "0.1.0";

export interface ProbeOk {
  ok: true;
  version: string;
  registrationOpen: boolean;
}

export interface ProbeError {
  ok: false;
  reason: "unreachable" | "unhealthy" | "not_crossclipper" | "server_too_old";
}

export type ProbeResult = ProbeOk | ProbeError;

// ─── semverGte ───────────────────────────────────────────────────────────────

/** Returns true if semver a >= b (major.minor.patch, numeric comparison). */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return true;
}

// ─── normalizeServerUrl ──────────────────────────────────────────────────────

/** Ensure the URL has a scheme and no trailing slash. Returns null if blank. */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/$/, "");
}

// ─── isInsecureHttp ──────────────────────────────────────────────────────────

const LOCAL_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|::1)$/i;

/**
 * Returns true when the URL uses plain http:// and points to a non-local host.
 * Local addresses (localhost, 127.x.x.x, 10.x.x.x, 192.168.x.x) do NOT warn —
 * mirrors the extension behaviour (only truly external http hosts are flagged).
 */
export function isInsecureHttp(url: string): boolean {
  if (!url.startsWith("http://")) return false;
  try {
    const { hostname } = new URL(url);
    if (LOCAL_HOSTS.test(hostname)) return false;
    // Private LAN ranges: 10.x, 172.16–31.x, 192.168.x
    if (/^10\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── probeServer ─────────────────────────────────────────────────────────────

/**
 * Probe a CrossClipper server at `baseUrl/health` via ApiClient.
 *
 * Returns:
 *   { ok: true, version, registrationOpen }        — healthy CrossClipper server
 *   { ok: false, reason: "unreachable" }            — network error
 *   { ok: false, reason: "unhealthy" }              — 503 / server degraded
 *   { ok: false, reason: "not_crossclipper" }       — health.app ≠ "crossclipper"
 *   { ok: false, reason: "server_too_old" }         — version < MIN_SERVER_VERSION
 */
export async function probeServer(
  baseUrl: string,
  fetchFn?: typeof fetch,
): Promise<ProbeResult> {
  const client = new ApiClient({ baseUrl, clientVersion: CLIENT_VERSION, fetchFn });
  try {
    const health = await client.health();
    if (health.app !== "crossclipper") return { ok: false, reason: "not_crossclipper" };
    if (!semverGte(health.version, MIN_SERVER_VERSION)) {
      return { ok: false, reason: "server_too_old" };
    }
    return { ok: true, version: health.version, registrationOpen: health.registration_open };
  } catch (err) {
    if (err instanceof NetworkError) return { ok: false, reason: "unreachable" };
    if (err instanceof ApiError && err.status === 503) return { ok: false, reason: "unhealthy" };
    return { ok: false, reason: "not_crossclipper" };
  }
}
