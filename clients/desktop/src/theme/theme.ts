export type ThemeSetting = "light" | "dark" | "auto";

export interface Appearance {
  theme: ThemeSetting;
  accent: string;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "auto", accent: "#d97706" };

/** localStorage mirror of the stored appearance — lets each webview apply the
 *  theme synchronously before first paint (plugin-store reads are async-only). */
export const APPEARANCE_MIRROR_KEY = "cc.appearance";

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): "light" | "dark" {
  return setting === "auto" ? (prefersDark ? "dark" : "light") : setting;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG relative luminance → readable text color on the accent.
 *  Amended 2026-07-04: crossover at luminance 0.179 (equal-contrast point);
 *  default amber (#d97706, luminance ≈ 0.23) therefore gets DARK text. */
export function accentForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 0.179 is the luminance where white and black text give equal WCAG contrast;
  // above it, dark text always wins (e.g. the default amber: 6.6:1 vs 3.2:1).
  return lum > 0.179 ? "#1c1917" : "#ffffff";
}

export function accentSoft(hex: string, alpha = 0.14): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_APPEARANCE.accent)!;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function applyAppearance(
  a: Appearance,
  root: HTMLElement = document.documentElement,
): void {
  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  root.dataset.theme = resolveTheme(a.theme, prefersDark);
  const accent = hexToRgb(a.accent) ? a.accent : DEFAULT_APPEARANCE.accent;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-fg", accentForeground(accent));
  root.style.setProperty("--accent-soft", accentSoft(accent));
}

export function loadAppearanceSync(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_MIRROR_KEY);
    if (raw) return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    /* corrupt mirror → defaults */
  }
  return DEFAULT_APPEARANCE;
}

/** Called at the very top of each webview's main.tsx — applies before first
 *  paint and re-applies when the OS scheme flips while the window is open. */
export function initTheme(): void {
  applyAppearance(loadAppearanceSync());
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyAppearance(loadAppearanceSync()));
}
