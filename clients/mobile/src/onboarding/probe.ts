/**
 * probeServer — contacts a CrossClipper server's /health endpoint and
 * classifies the response. Mirrors extension popup/onboarding/probe.ts.
 */

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

interface HealthResponse {
  status?: string;
  version?: string;
  registration_open?: boolean;
}

/**
 * Probe a CrossClipper server at `baseUrl/health`.
 *
 * Returns:
 *   { ok: true, version, registrationOpen }   — healthy CrossClipper server
 *   { ok: false, reason: "unreachable" }       — network error or non-2xx
 *   { ok: false, reason: "unhealthy" }         — status field present but ≠ "ok"
 *   { ok: false, reason: "not_crossclipper" }  — no recognisable status field
 */
export async function probeServer(baseUrl: string): Promise<ProbeResult> {
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/health`);
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (!resp.ok) return { ok: false, reason: "unreachable" };

  let body: HealthResponse;
  try {
    body = (await resp.json()) as HealthResponse;
  } catch {
    return { ok: false, reason: "not_crossclipper" };
  }

  if (typeof body.status === "undefined") return { ok: false, reason: "not_crossclipper" };
  if (body.status !== "ok") return { ok: false, reason: "unhealthy" };

  return {
    ok: true,
    version: body.version ?? "unknown",
    registrationOpen: body.registration_open ?? false,
  };
}
