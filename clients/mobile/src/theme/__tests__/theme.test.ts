/**
 * Theme engine tests — TDD step 1.
 * Pure-function coverage: resolveTheme, hexToRgb, relativeLuminance,
 * accentForeground, accentSoft, buildTokens.
 * ThemeProvider integration: useTheme / useAppearance round-trip.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react-native";

import {
  resolveTheme,
  hexToRgb,
  relativeLuminance,
  accentForeground,
  accentSoft,
  buildTokens,
  DEFAULT_APPEARANCE,
} from "../theme";
import { useTheme, useAppearance, ThemeProvider } from "../ThemeProvider";

// ─── resolveTheme ────────────────────────────────────────────────────────────

describe("resolveTheme", () => {
  it('auto + dark scheme → "dark"', () => {
    expect(resolveTheme("auto", "dark")).toBe("dark");
  });

  it('auto + light scheme → "light"', () => {
    expect(resolveTheme("auto", "light")).toBe("light");
  });

  it('explicit "light" overrides dark scheme', () => {
    expect(resolveTheme("light", "dark")).toBe("light");
  });

  it('explicit "dark" overrides light scheme', () => {
    expect(resolveTheme("dark", "light")).toBe("dark");
  });
});

// ─── hexToRgb ────────────────────────────────────────────────────────────────

describe("hexToRgb", () => {
  it("parses #d97706 correctly", () => {
    expect(hexToRgb("#d97706")).toEqual([0xd9, 0x77, 0x06]);
  });

  it("parses without leading # (d97706)", () => {
    expect(hexToRgb("d97706")).toEqual([0xd9, 0x77, 0x06]);
  });

  it("returns null for invalid hex", () => {
    expect(hexToRgb("not-a-color")).toBeNull();
    expect(hexToRgb("#fff")).toBeNull(); // 3-digit short form not supported
    expect(hexToRgb("")).toBeNull();
  });
});

// ─── relativeLuminance ───────────────────────────────────────────────────────

describe("relativeLuminance", () => {
  it("white [255,255,255] → 1.0", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1.0, 5);
  });

  it("black [0,0,0] → 0.0", () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0.0, 5);
  });

  it("amber #d97706 luminance > 0.179 (dark text needed)", () => {
    const rgb = hexToRgb("#d97706")!;
    expect(relativeLuminance(rgb)).toBeGreaterThan(0.179);
  });

  it("dark blue #1e3a8a luminance < 0.179 (white text needed)", () => {
    const rgb = hexToRgb("#1e3a8a")!;
    expect(relativeLuminance(rgb)).toBeLessThan(0.179);
  });
});

// ─── accentForeground ────────────────────────────────────────────────────────

describe("accentForeground", () => {
  it("amber #d97706 → dark text (#1c1917), ~6.6:1 contrast", () => {
    // The WCAG crossover rule: lum(#d97706) > 0.179 → dark text wins
    expect(accentForeground("#d97706")).toBe("#1c1917");
  });

  it("dark blue #1e3a8a → white text (#ffffff)", () => {
    expect(accentForeground("#1e3a8a")).toBe("#ffffff");
  });

  it("unparseable hex → #ffffff fallback", () => {
    expect(accentForeground("not-a-color")).toBe("#ffffff");
  });

  it("pure black #000000 → white text", () => {
    expect(accentForeground("#000000")).toBe("#ffffff");
  });

  it("pure white #ffffff → dark text", () => {
    expect(accentForeground("#ffffff")).toBe("#1c1917");
  });
});

// ─── accentSoft ──────────────────────────────────────────────────────────────

describe("accentSoft", () => {
  it("amber #d97706 → rgba string with default alpha 0.14", () => {
    expect(accentSoft("#d97706")).toBe("rgba(217, 119, 6, 0.14)");
  });

  it("custom alpha applied correctly", () => {
    expect(accentSoft("#d97706", 0.2)).toBe("rgba(217, 119, 6, 0.2)");
  });

  it("invalid hex falls back to default amber", () => {
    // falls back to DEFAULT_APPEARANCE.accent = #d97706 = rgb(217,119,6)
    expect(accentSoft("bad-color")).toBe("rgba(217, 119, 6, 0.14)");
  });
});

// ─── buildTokens ─────────────────────────────────────────────────────────────

describe("buildTokens", () => {
  const accent = "#d97706";

  describe("light scheme", () => {
    const tokens = buildTokens("light", accent);

    it("bg matches extension light value #f1f5f9", () => {
      expect(tokens.bg).toBe("#f1f5f9");
    });

    it("surface matches extension light value #ffffff", () => {
      expect(tokens.surface).toBe("#ffffff");
    });

    it("surfaceRaised matches extension light value #f8fafc", () => {
      expect(tokens.surfaceRaised).toBe("#f8fafc");
    });

    it("border matches extension light value #e2e8f0", () => {
      expect(tokens.border).toBe("#e2e8f0");
    });

    it("text matches extension light value #0f172a", () => {
      expect(tokens.text).toBe("#0f172a");
    });

    it("textMuted matches extension light value #64748b", () => {
      expect(tokens.textMuted).toBe("#64748b");
    });

    it("success matches extension light value #16a34a", () => {
      expect(tokens.success).toBe("#16a34a");
    });

    it("danger matches extension light value #dc2626", () => {
      expect(tokens.danger).toBe("#dc2626");
    });
  });

  describe("dark scheme", () => {
    const tokens = buildTokens("dark", accent);

    it("bg matches extension dark value #0f172a", () => {
      expect(tokens.bg).toBe("#0f172a");
    });

    it("surface matches extension dark value #1e293b", () => {
      expect(tokens.surface).toBe("#1e293b");
    });

    it("surfaceRaised matches extension dark value #334155", () => {
      expect(tokens.surfaceRaised).toBe("#334155");
    });

    it("border matches extension dark value #334155", () => {
      expect(tokens.border).toBe("#334155");
    });

    it("text matches extension dark value #f1f5f9", () => {
      expect(tokens.text).toBe("#f1f5f9");
    });

    it("textMuted matches extension dark value #94a3b8", () => {
      expect(tokens.textMuted).toBe("#94a3b8");
    });

    it("success matches extension dark value #4ade80", () => {
      expect(tokens.success).toBe("#4ade80");
    });

    it("danger matches extension dark value #f87171", () => {
      expect(tokens.danger).toBe("#f87171");
    });
  });

  it("light and dark produce different bg", () => {
    expect(buildTokens("light", accent).bg).not.toBe(
      buildTokens("dark", accent).bg,
    );
  });

  it("accentFg === accentForeground(accent)", () => {
    const tokens = buildTokens("dark", accent);
    expect(tokens.accentFg).toBe(accentForeground(accent));
  });

  it("accent token matches supplied accent hex", () => {
    expect(buildTokens("light", accent).accent).toBe(accent);
  });

  it("accentSoft token matches accentSoft(accent)", () => {
    const tokens = buildTokens("light", accent);
    expect(tokens.accentSoft).toBe(accentSoft(accent));
  });

  it("radius shape has sm, md, lg keys (numbers)", () => {
    const { radius } = buildTokens("light", accent);
    expect(typeof radius.sm).toBe("number");
    expect(typeof radius.md).toBe("number");
    expect(typeof radius.lg).toBe("number");
    expect(radius.sm).toBe(6);
    expect(radius.md).toBe(10);
    expect(radius.lg).toBe(16);
  });

  it("space shape has keys 1–5 (numbers)", () => {
    const { space } = buildTokens("light", accent);
    expect(space[1]).toBe(4);
    expect(space[2]).toBe(8);
    expect(space[3]).toBe(12);
    expect(space[4]).toBe(16);
    expect(space[5]).toBe(24);
  });
});

// ─── DEFAULT_APPEARANCE ──────────────────────────────────────────────────────

describe("DEFAULT_APPEARANCE", () => {
  it('theme is "auto"', () => {
    expect(DEFAULT_APPEARANCE.theme).toBe("auto");
  });

  it("accent is amber #d97706", () => {
    expect(DEFAULT_APPEARANCE.accent).toBe("#d97706");
  });
});

// ─── ThemeProvider + hooks ────────────────────────────────────────────────────

describe("ThemeProvider / useTheme / useAppearance", () => {
  // Wrap helper: renders hooks inside ThemeProvider
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(ThemeProvider, null, children);

  it("useTheme returns tokens with bg string", async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    // May be async while AsyncStorage resolves
    await act(async () => {});
    expect(typeof result.current.bg).toBe("string");
    expect(result.current.bg.startsWith("#")).toBe(true);
  });

  it("useAppearance returns DEFAULT_APPEARANCE initially", async () => {
    const { result } = renderHook(() => useAppearance(), { wrapper });
    await act(async () => {});
    expect(result.current.appearance.theme).toBe("auto");
    expect(result.current.appearance.accent).toBe("#d97706");
  });

  it("setAppearance updates appearance and persists to AsyncStorage", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    // The async-storage-mock exposes setItem on the default export object;
    // when accessed via require() the mock itself IS the default export.
    const storage = AsyncStorage.default ?? AsyncStorage;

    const { result } = renderHook(() => useAppearance(), { wrapper });
    await act(async () => {});

    await act(async () => {
      result.current.setAppearance({ theme: "dark", accent: "#2563eb" });
    });

    expect(result.current.appearance.theme).toBe("dark");
    expect(result.current.appearance.accent).toBe("#2563eb");

    // Should have persisted to AsyncStorage under the cc.appearance key
    expect(storage.setItem).toHaveBeenCalledWith(
      "cc.appearance",
      JSON.stringify({ theme: "dark", accent: "#2563eb" }),
    );
  });

  it("useTheme reflects updated accent after setAppearance", async () => {
    const { result } = renderHook(
      () => ({ tokens: useTheme(), appearance: useAppearance() }),
      { wrapper },
    );
    await act(async () => {});

    await act(async () => {
      result.current.appearance.setAppearance({ theme: "light", accent: "#1e3a8a" });
    });

    // accentFg for dark blue #1e3a8a should be white
    expect(result.current.tokens.accentFg).toBe("#ffffff");
  });

  it("throws when useTheme is used outside ThemeProvider", () => {
    // Suppress console.error for the expected thrown error
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow();
    spy.mockRestore();
  });
});
