import { type Appearance, type ThemeSetting } from "../../theme/theme";

const ACCENT_PRESETS: string[] = [
  "#d97706", // amber (default)
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#ea580c", // orange
];

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

interface ThemeControlsProps {
  appearance: Appearance;
  onChange(a: Appearance): void;
}

export function ThemeControls({ appearance, onChange }: ThemeControlsProps) {
  return (
    <div className="theme-controls">
      <fieldset className="theme-toggle">
        <legend>Theme</legend>
        <div className="chips" role="group" aria-label="Theme">
          {THEME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={`chip${appearance.theme === value ? " selected" : ""}`}
              aria-pressed={appearance.theme === value}
              onClick={() => onChange({ ...appearance, theme: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="accent-swatches">
        <legend>Accent color</legend>
        <div className="swatch-row" role="group" aria-label="Accent color presets">
          {ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              aria-label={`accent ${color}`}
              aria-pressed={appearance.accent === color}
              className={`swatch${appearance.accent === color ? " selected" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ ...appearance, accent: color })}
            />
          ))}
        </div>
        <label className="custom-accent">
          Custom
          <input
            type="color"
            value={appearance.accent}
            onChange={(e) => onChange({ ...appearance, accent: e.target.value })}
          />
        </label>
      </fieldset>
    </div>
  );
}
