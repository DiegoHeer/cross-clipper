/**
 * CrossClipper mobile theme engine.
 *
 * Pure functions — no React, no side effects, fully testable.
 * Token NAMES are the cross-client contract (extension spec §7); values mirror
 * `clients/extension/src/theme/tokens.css` exactly.
 * `accentForeground` uses the 0.179 WCAG equal-contrast crossover, ported
 * verbatim from `clients/extension/src/theme/theme.ts`.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeSetting = "light" | "dark" | "auto";

export interface Appearance {
  theme: ThemeSetting;
  accent: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "auto",
  accent: "#d97706",
};

/** AsyncStorage key — matches the extension's storage key convention. */
export const APPEARANCE_KEY = "cc.appearance";

/** All design tokens as native values (colors = hex strings, sizes = numbers). */
export interface Tokens {
  // Neutrals (slate)
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  // Semantic
  success: string;
  danger: string;
  // Accent (runtime)
  accent: string;
  accentFg: string;
  accentSoft: string;
  // Radii (native: numbers, no "px")
  radius: { sm: number; md: number; lg: number };
  // Spacing scale (native: numbers)
  space: { 1: number; 2: number; 3: number; 4: number; 5: number };
}

// ─── resolveTheme ────────────────────────────────────────────────────────────

/**
 * Maps a `ThemeSetting` + the current system color scheme to a concrete
 * "light" | "dark" value.
 *
 * `systemScheme` matches the string returned by RN `useColorScheme()`.
 */
export function resolveTheme(
  setting: ThemeSetting,
  systemScheme: "light" | "dark" | null | undefined,
): "light" | "dark" {
  if (setting !== "auto") return setting;
  return systemScheme === "dark" ? "dark" : "light";
}

// ─── Color math (ported verbatim from extension theme.ts) ────────────────────

/** Parse a 6-digit hex color string (with or without leading #). */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2.x relative luminance for a linearised RGB triple. */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick the highest-contrast foreground color for text on `hex`.
 *
 * Uses the WCAG equal-contrast crossover at luminance 0.179:
 *   - above 0.179 → dark stone (#1c1917) wins (e.g. amber: 6.6:1 vs 3.2:1)
 *   - at/below 0.179 → white (#ffffff) wins
 *
 * Unparseable hex → white fallback (matches extension behaviour).
 */
export function accentForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const lum = relativeLuminance(rgb);
  return lum > 0.179 ? "#1c1917" : "#ffffff";
}

/**
 * A translucent tint of `hex` for soft-accent backgrounds.
 * Falls back to the default amber if `hex` is unparseable.
 */
export function accentSoft(hex: string, alpha = 0.14): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_APPEARANCE.accent)!;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// ─── buildTokens ─────────────────────────────────────────────────────────────

/** Static slate palette for light and dark schemes. */
const SLATE = {
  light: {
    bg: "#f1f5f9",
    surface: "#ffffff",
    surfaceRaised: "#f8fafc",
    border: "#e2e8f0",
    text: "#0f172a",
    textMuted: "#64748b",
    success: "#16a34a",
    danger: "#dc2626",
  },
  dark: {
    bg: "#0f172a",
    surface: "#1e293b",
    surfaceRaised: "#334155",
    border: "#334155",
    text: "#f1f5f9",
    textMuted: "#94a3b8",
    success: "#4ade80",
    danger: "#f87171",
  },
} as const;

/**
 * Build a full `Tokens` object for a given resolved color scheme and accent.
 * All values mirror `clients/extension/src/theme/tokens.css` exactly.
 */
export function buildTokens(
  scheme: "light" | "dark",
  accent: string,
): Tokens {
  const palette = SLATE[scheme];
  const validAccent = hexToRgb(accent) ? accent : DEFAULT_APPEARANCE.accent;

  return {
    // Neutrals
    ...palette,
    // Accent
    accent: validAccent,
    accentFg: accentForeground(validAccent),
    accentSoft: accentSoft(validAccent),
    // Radii (native numbers — no "px"; mirrors CSS scale 6/10/+ extension lg=16)
    radius: { sm: 6, md: 10, lg: 16 },
    // Spacing scale (native numbers — mirrors CSS --space-{1..5})
    space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24 },
  };
}
