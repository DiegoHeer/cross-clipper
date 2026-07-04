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
  it("auto follows the system scheme", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });
  it("manual override wins over the system scheme", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("accent derivation", () => {
  it("parses hex", () => {
    expect(hexToRgb("#d97706")).toEqual([217, 119, 6]);
    expect(hexToRgb("nonsense")).toBeNull();
  });
  it("default amber gets white foreground; light accents get dark foreground", () => {
    expect(accentForeground("#d97706")).toBe("#1c1917");
    expect(accentForeground("#fde047")).toBe("#1c1917"); // light yellow
  });
  it("soft accent is a translucent tint of the accent", () => {
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

describe("appearance mirror", () => {
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
