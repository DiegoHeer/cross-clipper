import { useState } from "react";
import { ApiClient } from "@crossclipper/core";
import { CLIENT_VERSION } from "../../background/controller";
import { requestWorker } from "../../shared/messages";
import { saveAuth } from "../../shared/settings";

export function suggestDeviceName(
  ua: string = navigator.userAgent,
  platform: string = navigator.platform,
): string {
  const os = /win/i.test(platform)
    ? "Windows"
    : /mac/i.test(platform)
      ? "Mac"
      : /linux/i.test(platform)
        ? "Linux"
        : "";
  const browserName = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : "Chrome";
  return os ? `${os} — ${browserName}` : "My browser";
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
  const [deviceName, setDeviceName] = useState(suggestDeviceName());
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
        platform: "extension",
      });
      await saveAuth({ baseUrl, token: login.token, deviceId: login.device_id, deviceName });
      await requestWorker({ type: "refresh" });
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
      {notice && <p className="warning" role="alert">{notice}</p>}
      <p className="text-muted">{baseUrl.replace(/^https?:\/\//, "")}</p>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Device name
        <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy || !email || !password} onClick={() => void submit()}>
        {cta}
      </button>
    </div>
  );
}
