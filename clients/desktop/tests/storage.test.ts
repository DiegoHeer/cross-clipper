import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@crossclipper/core";
import { Store } from "./tauriMock";
import { TauriStorage } from "../src/shared/storage";

describe("TauriStorage implements SyncStorage", () => {
  it("round-trips string values and returns null for missing keys", async () => {
    const s = new TauriStorage(new Store());
    expect(await s.get("cc.cursor")).toBeNull();
    await s.set("cc.cursor", "abc");
    expect(await s.get("cc.cursor")).toBe("abc");
  });

  it("is substitutable for MemoryStorage (same contract)", async () => {
    const impls = [new TauriStorage(new Store()), new MemoryStorage()];
    for (const s of impls) {
      await s.set("k", "v");
      expect(await s.get("k")).toBe("v");
      expect(await s.get("missing")).toBeNull();
    }
  });

  it("sign-out sentinel: empty string is stored and returned (not null)", async () => {
    const s = new TauriStorage(new Store());
    await s.set("cc.auth", "");
    expect(await s.get("cc.auth")).toBe("");
  });

  it("overwriting a key replaces the value", async () => {
    const s = new TauriStorage(new Store());
    await s.set("cc.cursor", "first");
    await s.set("cc.cursor", "second");
    expect(await s.get("cc.cursor")).toBe("second");
  });
});
