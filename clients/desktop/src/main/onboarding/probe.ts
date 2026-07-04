export const MIN_SERVER_VERSION = "0.1.0";

export type ProbeResult =
  | { ok: true; version: string; registrationOpen: boolean }
  | { ok: false; reason: "unreachable" | "unhealthy" | "not_crossclipper" | "server_too_old" };

/** Returns `"https://" + host` for a bare host, strips trailing slash,
 *  returns null for strings that don't parse as a URL at all. */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/, ""));
  } catch {
    return null;
  }
}

const PRIVATE_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** Returns true when the URL uses plain http:// to a non-private host — user
 *  should be warned that traffic is unencrypted. */
export function isInsecureHttp(url: string): boolean {
  if (!/^http:\/\//i.test(url)) return false;
  try {
    const { hostname } = new URL(url);
    return !PRIVATE_HOSTS.test(hostname);
  } catch {
    return false;
  }
}

/** `a >= b` for simple semver strings (major.minor.patch). */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return true;
}

/** Hit `GET /health` and return a typed result. */
export async function probeServer(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!res.ok) return { ok: false, reason: "unhealthy" };
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "not_crossclipper" };
  }
  if (body.code !== "ok" || typeof body.version !== "string") {
    return { ok: false, reason: "not_crossclipper" };
  }
  if (!semverGte(body.version, MIN_SERVER_VERSION)) {
    return { ok: false, reason: "server_too_old" };
  }
  return {
    ok: true,
    version: body.version,
    registrationOpen: body.registration_open === true,
  };
}
