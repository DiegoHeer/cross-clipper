import { useState } from "react";
import browser from "webextension-polyfill";
import { isInsecureHttp, normalizeServerUrl, probeServer, type ProbeResult } from "./probe";

const ERRORS: Record<Exclude<ProbeResult, { ok: true }>["reason"], string> = {
  unreachable: "Could not reach the server. Check the address and your network.",
  unhealthy: "Server is reachable but not healthy. Check server logs.",
  not_crossclipper: "The server did not identify itself as CrossClipper.",
  server_too_old:
    "Server version is too old for this extension. Update your CrossClipper server.",
};

export interface ServerStepProps {
  initialUrl?: string;
  onNext(baseUrl: string, probe: Extract<ProbeResult, { ok: true }>): void;
}

export function ServerStep({ initialUrl = "", onNext }: ServerStepProps) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalized = normalizeServerUrl(url);
  const insecure = normalized !== null && isInsecureHttp(normalized);

  const next = async () => {
    setError(null);
    setFound(null);
    if (!normalized) {
      setError("Enter your server address, e.g. https://clip.example.com");
      return;
    }
    setBusy(true);
    try {
      try {
        await browser.permissions.request({ origins: [`${new URL(normalized).origin}/*`] });
      } catch {
        /* pre-granted (localhost) or pattern rejected — the probe decides */
      }
      const probe = await probeServer(normalized);
      if (!probe.ok) {
        setError(ERRORS[probe.reason]);
        return;
      }
      setFound(`✓ CrossClipper v${probe.version} found`);
      onNext(normalized, probe);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-step">
      <h2>Your server</h2>
      <p className="text-muted">
        CrossClipper is self-hosted — point the extension at your server.
      </p>
      <input
        type="text"
        value={url}
        placeholder="https://clip.example.com"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void next()}
      />
      {insecure && (
        <p className="warning" role="alert">
          ⚠ Plain http:// to a non-local address sends your clipboard and password unencrypted.
          Put TLS in front of your server.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {found && <p className="success">{found}</p>}
      <button disabled={busy} onClick={() => void next()}>
        Next
      </button>
    </div>
  );
}
