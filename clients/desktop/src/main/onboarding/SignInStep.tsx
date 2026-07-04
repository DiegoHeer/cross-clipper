import { useState } from "react";
import { ApiClient } from "@crossclipper/core";
import { CLIENT_VERSION } from "../../background/controller";
import { requestBackground } from "../../shared/bridge";
import { saveAuth } from "../../shared/settings";

/** Suggest a device name from the OS. Falls back to "This PC" if the
 *  @tauri-apps/plugin-os hostname() is unavailable or throws.
 *  Note: @tauri-apps/plugin-os is NOT declared in package.json — this uses
 *  a dynamic import with type suppression so the static fallback is used in
 *  tests and CI type-check. The plugin is available at runtime via Tauri's
 *  bundled plugin-os from the Cargo.toml declaration (if added by a later PR). */
export async function suggestDeviceName(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("@tauri-apps/plugin-os" as any);
    const h = await (mod as { hostname(): Promise<string | null> }).hostname();
    if (h && h.trim()) return h.trim();
  } catch {
    /* plugin absent or not declared — fall through to static fallback */
  }
  return "This PC";
}

export interface SignInStepProps {
  baseUrl: string;
  mode: "signin" | "create" | "reauth";
  notice?: string;
  onDone(): void;
}

export function SignInStep({ baseUrl, mode, notice, onDone }: SignInStepProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState("This PC");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const heading = mode === "create" ? "Create your account" : "Sign in";
  const cta = mode === "create" ? "Create account" : "Sign in";

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const client = new ApiClient({ baseUrl, clientVersion: CLIENT_VERSION });
      if (mode === "create") await client.register(email, password);
      const login = await client.login({
        email,
        password,
        device_name: deviceName,
        platform: "desktop",
      });
      await saveAuth({ baseUrl, token: login.token, deviceId: login.device_id, deviceName });
      await requestBackground({ type: "refresh" });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-step">
      {heading && <h2>{heading}</h2>}
      {notice && (
        <p className="warning" role="alert">
          {notice}
        </p>
      )}
      <p className="text-muted">{baseUrl.replace(/^https?:\/\//, "")}</p>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Device name
        <input
          type="text"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy || !email || !password} onClick={() => void submit()}>
        {cta}
      </button>
    </div>
  );
}
