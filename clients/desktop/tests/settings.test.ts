import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "./tauriMock";
import {
  DEFAULT_HOTKEYS,
  DEFAULT_PREFS,
  clearAuth,
  loadAuth,
  loadHotkeys,
  loadPrefs,
  saveAuth,
  saveHotkeys,
  savePrefs,
  saveAppearance,
  __setStore,
} from "../src/shared/settings";

describe("settings store", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
  });

  it("auth round-trips and clears", async () => {
    expect(await loadAuth()).toBeNull();
    const auth = { baseUrl: "http://s", token: "t", deviceId: "d", deviceName: "n" };
    await saveAuth(auth);
    expect(await loadAuth()).toEqual(auth);
    await clearAuth();
    expect(await loadAuth()).toBeNull();
  });

  it("prefs default and merge patches", async () => {
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
    await savePrefs({ notifyOnNewItems: true });
    expect(await loadPrefs()).toMatchObject({ notifyOnNewItems: true });
  });

  it("hotkeys default to Ctrl+Alt+C / Ctrl+Alt+V and persist", async () => {
    expect(await loadHotkeys()).toEqual(DEFAULT_HOTKEYS);
    await saveHotkeys({ capture: "Ctrl+Shift+K", flyout: "Ctrl+Alt+V" });
    expect((await loadHotkeys()).capture).toBe("Ctrl+Shift+K");
  });

  it("saveAppearance mirrors to localStorage for pre-paint reads", async () => {
    await saveAppearance({ theme: "dark", accent: "#2563eb" });
    expect(JSON.parse(localStorage.getItem("cc.appearance")!)).toEqual({
      theme: "dark",
      accent: "#2563eb",
    });
  });
});
