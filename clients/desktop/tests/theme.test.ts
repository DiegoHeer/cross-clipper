import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  accentForeground,
  accentSoft,
  applyAppearance,
  hexToRgb,
  loadAppearanceSync,
  resolveTheme,
} from "../src/theme/theme";

describe("theme resolution", () => {
  it("auto follows the system scheme; manual overrides win", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("accent derivation (amended WCAG crossover at luminance 0.179)", () => {
  it("parses hex", () => {
    expect(hexToRgb("#d97706")).toEqual([217, 119, 6]);
    expect(hexToRgb("nonsense")).toBeNull();
  });
  it("default amber gets DARK foreground (crossover rule); light-on-dark accents get white", () => {
    expect(accentForeground("#d97706")).toBe("#1c1917"); // amber luminance > 0.179 → dark text
    expect(accentForeground("#1e3a8a")).toBe("#ffffff"); // dark blue → white text
    expect(accentForeground("#fde047")).toBe("#1c1917"); // light yellow → dark text
  });
  it("soft accent is a translucent tint", () => {
    expect(accentSoft("#d97706")).toBe("rgba(217, 119, 6, 0.14)");
  });
});

describe("applyAppearance", () => {
  it("sets data-theme and the three accent custom properties", () => {
    const root = document.createElement("div");
    applyAppearance({ theme: "dark", accent: "#2563eb" }, root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--accent")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--accent-fg")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--accent-soft")).toBe("rgba(37, 99, 235, 0.14)");
  });
  it("falls back to default amber on an unparseable accent", () => {
    const root = document.createElement("div");
    applyAppearance({ theme: "light", accent: "garbage" }, root);
    expect(root.style.getPropertyValue("--accent")).toBe(DEFAULT_APPEARANCE.accent);
  });
});

describe("appearance mirror (localStorage)", () => {
  it("returns defaults when the mirror is empty or corrupt", () => {
    localStorage.removeItem("cc.appearance");
    expect(loadAppearanceSync()).toEqual(DEFAULT_APPEARANCE);
    localStorage.setItem("cc.appearance", "{not json");
    expect(loadAppearanceSync()).toEqual(DEFAULT_APPEARANCE);
  });
  it("merges a stored partial over defaults", () => {
    localStorage.setItem("cc.appearance", JSON.stringify({ accent: "#16a34a" }));
    expect(loadAppearanceSync()).toEqual({ theme: "auto", accent: "#16a34a" });
  });
});
