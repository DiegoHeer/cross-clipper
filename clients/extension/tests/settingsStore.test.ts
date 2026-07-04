import { beforeEach, describe, expect, it } from "vitest";
import { setFakeBrowser } from "./polyfillMock";
import { makeFakeBrowser } from "./fakeBrowser";

describe("settings store", () => {
  beforeEach(() => {
    setFakeBrowser(makeFakeBrowser().browser);
    localStorage.clear();
  });

  it("auth round-trips and clears", async () => {
    const { loadAuth, saveAuth, clearAuth } = await import("../src/shared/settings");
    expect(await loadAuth()).toBeNull();
    const auth = { baseUrl: "http://s", token: "t", deviceId: "d", deviceName: "n" };
    await saveAuth(auth);
    expect(await loadAuth()).toEqual(auth);
    await clearAuth();
    expect(await loadAuth()).toBeNull();
  });

  it("prefs default and merge patches", async () => {
    const { DEFAULT_PREFS, loadPrefs, savePrefs } = await import("../src/shared/settings");
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
    await savePrefs({ notifyOnNewItems: true });
    expect(await loadPrefs()).toEqual({ notifyOnNewItems: true, contextMenuSend: true });
  });

  it("saveAppearance mirrors to localStorage for pre-paint reads", async () => {
    const { saveAppearance } = await import("../src/shared/settings");
    await saveAppearance({ theme: "dark", accent: "#2563eb" });
    expect(JSON.parse(localStorage.getItem("cc.appearance")!)).toEqual({
      theme: "dark",
      accent: "#2563eb",
    });
  });
});
