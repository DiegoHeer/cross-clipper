import { useEffect, useState } from "react";
import { loadPrefs, savePrefs, type Prefs } from "../../shared/settings";

export function GeneralTab() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
  }, []);

  if (!prefs) return null;

  function toggle(key: keyof Prefs) {
    const next = { ...prefs!, [key]: !prefs![key] };
    setPrefs(next);
    void savePrefs({ [key]: next[key] });
  }

  return (
    <div className="general-tab">
      <label className="pref-row">
        <input
          type="checkbox"
          checked={prefs.notifyOnNewItems}
          onChange={() => toggle("notifyOnNewItems")}
        />
        Notify me on new items
      </label>
      <label className="pref-row">
        <input
          type="checkbox"
          checked={prefs.contextMenuSend}
          onChange={() => toggle("contextMenuSend")}
        />
        Context-menu send
      </label>
    </div>
  );
}
