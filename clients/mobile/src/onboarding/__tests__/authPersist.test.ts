/**
 * authPersist.test.ts — NIT: dual-write coverage (Finding 4).
 *
 * Verifies that:
 *   - saveAuth() writes to AsyncStorage AND the App Group shared container.
 *   - clearAuth() clears from both.
 *
 * Uses the AsyncStorage mock (jest.setup.ts) and a fake AppGroupShim backed by
 * an in-memory store injected via jest.mock — no native modules touched.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── In-memory store shared between mock factory and test assertions ──────────
//
// Jest hoists jest.mock() above imports, so we cannot reference variables
// declared in the test module body inside the factory. Use a plain object
// reference that is mutated by the factory instead.

const agStore: Record<string, string> = {};

jest.mock("../../platform/appGroup", () => {
  // Local store reference — safe inside the factory.
  const store = agStore;

  const fakeShim = {
    async getItem(key: string) { return store[key] ?? null; },
    async setItem(key: string, value: string) { store[key] = value; },
    async removeItem(key: string) { delete store[key]; },
  };

  const { makeAppGroup } = jest.requireActual("../../platform/appGroup") as {
    makeAppGroup: (shim: typeof fakeShim) => unknown;
  };

  return {
    appGroup: makeAppGroup(fakeShim),
    makeAppGroup,
  };
});

import { saveAuth, clearAuth, loadAuth, AUTH_KEY } from "../authPersist";
import { appGroup } from "../../platform/appGroup";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BUNDLE = {
  baseUrl: "https://cc.example.com",
  token: "tok-abc",
  deviceId: "dev-1",
  deviceName: "My iPhone",
};

function clearAgStore() {
  for (const k of Object.keys(agStore)) {
    delete agStore[k];
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("authPersist — dual-write seam", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearAgStore();
  });

  describe("saveAuth", () => {
    it("writes the bundle to AsyncStorage under AUTH_KEY", async () => {
      await saveAuth(BUNDLE);
      const raw = await AsyncStorage.getItem(AUTH_KEY);
      expect(JSON.parse(raw ?? "null")).toEqual(BUNDLE);
    });

    it("writes the bundle to the App Group container", async () => {
      await saveAuth(BUNDLE);
      const fromGroup = await appGroup.readAuth();
      expect(fromGroup).toEqual(BUNDLE);
    });

    it("both stores contain the same bundle after saveAuth", async () => {
      await saveAuth(BUNDLE);
      const fromAsync = JSON.parse(
        (await AsyncStorage.getItem(AUTH_KEY)) ?? "null",
      );
      const fromGroup = await appGroup.readAuth();
      expect(fromAsync).toEqual(BUNDLE);
      expect(fromGroup).toEqual(BUNDLE);
    });
  });

  describe("clearAuth", () => {
    it("removes the bundle from AsyncStorage", async () => {
      await saveAuth(BUNDLE);
      await clearAuth();
      expect(await AsyncStorage.getItem(AUTH_KEY)).toBeNull();
    });

    it("removes the bundle from the App Group container", async () => {
      await saveAuth(BUNDLE);
      await clearAuth();
      expect(await appGroup.readAuth()).toBeNull();
    });

    it("both stores are cleared after clearAuth", async () => {
      await saveAuth(BUNDLE);
      await clearAuth();
      const fromAsync = await AsyncStorage.getItem(AUTH_KEY);
      const fromGroup = await appGroup.readAuth();
      expect(fromAsync).toBeNull();
      expect(fromGroup).toBeNull();
    });

    it("clearAuth is safe when nothing is stored", async () => {
      await expect(clearAuth()).resolves.toBeUndefined();
    });
  });

  describe("loadAuth", () => {
    it("returns the bundle after saveAuth", async () => {
      await saveAuth(BUNDLE);
      expect(await loadAuth()).toEqual(BUNDLE);
    });

    it("returns null when nothing is stored", async () => {
      expect(await loadAuth()).toBeNull();
    });
  });
});
