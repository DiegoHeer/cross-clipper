import type { Appearance, ThemeSetting } from "../../theme/theme";
import { applyAppearance } from "../../theme/theme";

export const ACCENT_PRESETS = ["#d97706", "#2563eb", "#16a34a", "#7c3aed", "#e11d48"];

export interface ThemeControlsProps {
  appearance: Appearance;
  onChange(a: Appearance): void;
}

export function ThemeControls({ appearance, onChange }: ThemeControlsProps) {
  const update = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    applyAppearance(next); // live preview
    onChange(next);
  };

  return (
    <div className="theme-controls">
      <div className="chips" role="group" aria-label="Theme">
        {(["light", "dark", "auto"] as ThemeSetting[]).map((t) => (
          <button
            key={t}
            className="chip"
            aria-pressed={appearance.theme === t}
            onClick={() => update({ theme: t })}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Accent color">
        {ACCENT_PRESETS.map((hex) => (
          <button
            key={hex}
            className="swatch"
            style={{ background: hex }}
            aria-label={`Accent ${hex}`}
            aria-pressed={appearance.accent === hex}
            onClick={() => update({ accent: hex })}
          />
        ))}
        <input
          type="color"
          aria-label="Custom accent"
          value={appearance.accent}
          onChange={(e) => update({ accent: e.target.value })}
        />
      </div>
      <article className="card preview-card">
        <header className="card-header">
          <span>🌐 Preview</span>
          <time className="text-muted">just now</time>
        </header>
        <p className="card-body">This is how your feed will look.</p>
        <footer className="card-actions">
          <button>⧉ Copy</button>
        </footer>
      </article>
    </div>
  );
}
