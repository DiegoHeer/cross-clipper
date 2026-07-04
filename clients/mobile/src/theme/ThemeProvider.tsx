/**
 * ThemeProvider — React context glue for the CrossClipper theme engine.
 *
 * - Reads/writes `Appearance` from AsyncStorage (key: "cc.appearance").
 * - Subscribes to RN `useColorScheme` for system-adaptive light/dark.
 * - Manual override: `setAppearance({ theme: "dark", ... })` pins the scheme.
 * - Exposes `useTheme(): Tokens` and `useAppearance()` hooks.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  Appearance,
  DEFAULT_APPEARANCE,
  APPEARANCE_KEY,
  Tokens,
  buildTokens,
  resolveTheme,
  hexToRgb,
} from "./theme";

// ─── Contexts ────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  tokens: Tokens;
}

interface AppearanceContextValue {
  appearance: Appearance;
  setAppearance: (next: Appearance) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

// ─── ThemeProvider ───────────────────────────────────────────────────────────

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [loaded, setLoaded] = useState(false);

  // Load persisted appearance on mount
  useEffect(() => {
    AsyncStorage.getItem(APPEARANCE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<Appearance>;
            setAppearanceState({ ...DEFAULT_APPEARANCE, ...parsed });
          } catch {
            // corrupt storage → keep defaults
          }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  // Persist appearance changes
  const setAppearance = useCallback((next: Appearance) => {
    // Validate accent — fall back to default if unparseable
    const validAccent = hexToRgb(next.accent) ? next.accent : DEFAULT_APPEARANCE.accent;
    const normalised: Appearance = { ...next, accent: validAccent };
    setAppearanceState(normalised);
    AsyncStorage.setItem(APPEARANCE_KEY, JSON.stringify(normalised)).catch(
      () => {
        // Persistence failure is non-fatal; in-memory state is still updated.
      },
    );
  }, []);

  const scheme = resolveTheme(appearance.theme, systemScheme);

  // Build tokens — memoised so downstream consumers only re-render when
  // the resolved scheme or accent actually changes.
  const tokens = useMemo(
    () => buildTokens(scheme, appearance.accent),
    [scheme, appearance.accent],
  );

  const themeValue = useMemo<ThemeContextValue>(() => ({ tokens }), [tokens]);
  const appearanceValue = useMemo<AppearanceContextValue>(
    () => ({ appearance, setAppearance }),
    [appearance, setAppearance],
  );

  // Render children regardless of `loaded` so that the default tokens are
  // available immediately (avoids a layout flash).  The AsyncStorage load
  // updates state once, causing at most one extra render.
  void loaded; // suppress unused-var; kept for possible future guard

  return (
    <AppearanceContext.Provider value={appearanceValue}>
      <ThemeContext.Provider value={themeValue}>
        {children}
      </ThemeContext.Provider>
    </AppearanceContext.Provider>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Returns the current design-token set.
 * Must be called inside `<ThemeProvider>`.
 */
export function useTheme(): Tokens {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx.tokens;
}

/**
 * Returns the current appearance setting and a setter.
 * Must be called inside `<ThemeProvider>`.
 */
export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error("useAppearance must be used inside <ThemeProvider>");
  }
  return ctx;
}
