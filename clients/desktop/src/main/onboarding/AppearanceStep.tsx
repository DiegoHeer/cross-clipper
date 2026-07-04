import { useState } from "react";
import { DEFAULT_APPEARANCE, type Appearance } from "../../theme/theme";
import { saveAppearance } from "../../shared/settings";
import { ThemeControls } from "../components/ThemeControls";

export function AppearanceStep({ onFinish }: { onFinish(): void }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  const finish = async (persist: boolean) => {
    if (persist) await saveAppearance(appearance);
    onFinish();
  };

  return (
    <div className="onboarding-step">
      <h2>Appearance</h2>
      <ThemeControls appearance={appearance} onChange={setAppearance} />
      <section role="region" aria-label="Preview" className="preview-card">
        <div className="preview-card-header">
          <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>just now</span>
        </div>
        <p style={{ margin: "0 0 var(--space-2)", fontSize: "13px", color: "var(--text)" }}>
          Hello from CrossClipper — this is how your feed will look.
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            type="button"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "2px 10px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Copy
          </button>
        </div>
      </section>
      <footer className="card-actions">
        <button onClick={() => void finish(false)}>Skip</button>
        <button onClick={() => void finish(true)}>Start using CrossClipper</button>
      </footer>
    </div>
  );
}
