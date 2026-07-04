/**
 * prefs.test.ts — Task 9 TDD step 1.
 *
 * Prefs: default notifyOnNewItems === false; toggle persists.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadPrefs, savePrefs, DEFAULT_PREFS, PREFS_KEY } from "../prefs";

// The jest mock for async-storage is set up in jest.setup.ts
// Access the underlying mock to inspect calls.
function getStorage() {
  // jest-expo mock: the default export IS the mock object.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AS = require("@react-native-async-storage/async-storage");
  return AS.default ?? AS;
}

describe("prefs", () => {
  beforeEach(() => {
    const storage = getStorage();
    storage.clear?.();
    jest.clearAllMocks();
  });

  it("DEFAULT_PREFS.notifyOnNewItems is false", () => {
    expect(DEFAULT_PREFS.notifyOnNewItems).toBe(false);
  });

  it("loadPrefs returns defaults when nothing is stored", async () => {
    const prefs = await loadPrefs();
    expect(prefs.notifyOnNewItems).toBe(false);
  });

  it("savePrefs persists prefs to AsyncStorage", async () => {
    const storage = getStorage();
    await savePrefs({ notifyOnNewItems: true });
    expect(storage.setItem).toHaveBeenCalledWith(
      PREFS_KEY,
      JSON.stringify({ notifyOnNewItems: true }),
    );
  });

  it("loadPrefs reads back saved prefs", async () => {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ notifyOnNewItems: true }));
    const prefs = await loadPrefs();
    expect(prefs.notifyOnNewItems).toBe(true);
  });

  it("loadPrefs merges with defaults for partial data", async () => {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({}));
    const prefs = await loadPrefs();
    expect(prefs.notifyOnNewItems).toBe(false);
  });
});
