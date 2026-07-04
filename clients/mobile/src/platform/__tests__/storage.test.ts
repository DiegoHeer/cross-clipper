import AsyncStorage from "@react-native-async-storage/async-storage";
import { AsyncStorageAdapter } from "../storage";

// AsyncStorage is mocked via jest.setup.ts → async-storage-mock

describe("AsyncStorageAdapter", () => {
  let adapter: AsyncStorageAdapter;

  beforeEach(async () => {
    await AsyncStorage.clear();
    adapter = new AsyncStorageAdapter();
  });

  it("set then get roundtrips a string value", async () => {
    await adapter.set("cc.cursor", "abc123");
    const result = await adapter.get("cc.cursor");
    expect(result).toBe("abc123");
  });

  it("get of a missing key returns null", async () => {
    const result = await adapter.get("cc.missing");
    expect(result).toBeNull();
  });

  it("remove deletes a previously set key", async () => {
    await adapter.set("cc.cursor", "to-be-deleted");
    await adapter.remove("cc.cursor");
    const result = await adapter.get("cc.cursor");
    expect(result).toBeNull();
  });

  it("remove on a missing key does not throw", async () => {
    await expect(adapter.remove("cc.nonexistent")).resolves.toBeUndefined();
  });

  it("overwriting a key with set replaces the value", async () => {
    await adapter.set("cc.cursor", "first");
    await adapter.set("cc.cursor", "second");
    const result = await adapter.get("cc.cursor");
    expect(result).toBe("second");
  });
});
