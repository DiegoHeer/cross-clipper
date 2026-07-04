import { ApiClient, ApiError, NetworkError } from "@crossclipper/core";
import { CLIENT_VERSION } from "../../background/controller";

/** Oldest server this client can talk to ("client requires newer server"). */
export const MIN_SERVER_VERSION = "0.1.0";

export type ProbeResult =
  | { ok: true; version: string; registrationOpen: boolean }
  | { ok: false; reason: "unreachable" | "unhealthy" | "not_crossclipper" | "server_too_old" };

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname || url.hostname.includes(" ")) return null;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Spec §5: warn loudly on plain http:// for non-local addresses. */
export function isInsecureHttp(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    return !PRIVATE_HOST.test(u.hostname) && !u.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

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
