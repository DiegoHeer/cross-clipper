import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";
import {
  loadHotkeys,
  loadPrefs,
  saveHotkeys,
  savePrefs,
  type HotkeysConfig,
  type Prefs,
} from "../../shared/settings";

export function CaptureTab() {
  const [hotkeys, setHotkeys] = useState<HotkeysConfig | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  // Local editable combo fields
  const [captureCombo, setCaptureCombo] = useState("");
  const [flyoutCombo, setFlyoutCombo] = useState("");
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeyBusy, setHotkeyBusy] = useState(false);

  useEffect(() => {
    void loadHotkeys().then((h) => {
      setHotkeys(h);
      setCaptureCombo(h.capture);
      setFlyoutCombo(h.flyout);
    });
    void loadPrefs().then(setPrefs);
  }, []);

  const applyHotkeys = async () => {
    if (!captureCombo.trim() || !flyoutCombo.trim()) return;
    setHotkeyError(null);
    setHotkeyBusy(true);
    try {
      await invoke("register_hotkeys", {
        capture: captureCombo.trim(),
        flyout: flyoutCombo.trim(),
      });
      const next: HotkeysConfig = { capture: captureCombo.trim(), flyout: flyoutCombo.trim() };
      await saveHotkeys(next);
      setHotkeys(next);
    } catch (err) {
      setHotkeyError("Combo taken — pick another");
    } finally {
      setHotkeyBusy(false);
    }
  };

  const toggleToast = async () => {
    if (!prefs) return;
    const next = { ...prefs, captureToastEnabled: !prefs.captureToastEnabled };
    setPrefs(next);
    await savePrefs({ captureToastEnabled: next.captureToastEnabled });
  };

  const toggleAutostart = async () => {
    if (!prefs) return;
    const next = { ...prefs, launchAtLogin: !prefs.launchAtLogin };
    setPrefs(next);
    await savePrefs({ launchAtLogin: next.launchAtLogin });
    try {
      if (next.launchAtLogin) {
        await autostartEnable();
      } else {
        await autostartDisable();
      }
    } catch {
      // Non-fatal — autostart is best-effort
    }
  };

  if (!hotkeys || !prefs) return null;

  return (
    <div className="capture-tab">
      <section className="settings-section">
        <h3>Hotkeys</h3>
        <label className="pref-row">
          Capture
          <input
            type="text"
            aria-label="Capture hotkey"
            value={captureCombo}
            onChange={(e) => setCaptureCombo(e.target.value)}
          />
        </label>
        <label className="pref-row">
          Show flyout
          <input
            type="text"
            aria-label="Flyout hotkey"
            value={flyoutCombo}
            onChange={(e) => setFlyoutCombo(e.target.value)}
          />
        </label>
        {hotkeyError && (
          <p className="error" role="alert">
            {hotkeyError}
          </p>
        )}
        <button disabled={hotkeyBusy} onClick={() => void applyHotkeys()}>
          Apply hotkeys
        </button>
      </section>

      <section className="settings-section">
        <h3>Capture toast</h3>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={prefs.captureToastEnabled}
            onChange={() => void toggleToast()}
          />
          Show capture toast
        </label>
      </section>

      <section className="settings-section">
        <h3>Startup</h3>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={prefs.launchAtLogin}
            onChange={() => void toggleAutostart()}
          />
          Launch at login
        </label>
      </section>
    </div>
  );
}
