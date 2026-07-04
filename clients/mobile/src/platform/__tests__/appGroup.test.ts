/**
 * appGroup.test.ts — Task 12 TDD step 1 (failing → pass after implementation).
 *
 * Verifies the App Group bridge using a fake (injectable) native shim.
 * Jest never touches native modules — all I/O goes through the injected shim.
 */
import type { AppGroupShim } from "../appGroup";
import { makeAppGroup } from "../appGroup";

// ─── Fake shim ────────────────────────────────────────────────────────────────

function makeFakeShim(): AppGroupShim & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    async getItem(key: string) {
      return store[key] ?? null;
    },
    async setItem(key: string, value: string) {
      store[key] = value;
    },
    async removeItem(key: string) {
      delete store[key];
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("appGroup (App Group bridge)", () => {
  describe("writeAuth / readAuth roundtrip", () => {
    it("readAuth returns null when nothing stored", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      expect(await ag.readAuth()).toBeNull();
    });

    it("writeAuth then readAuth returns the bundle", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      const bundle = {
        baseUrl: "https://cc.example.com",
        token: "tok-abc",
        deviceId: "dev-123",
        deviceName: "My iPhone",
      };
      await ag.writeAuth(bundle);
      expect(await ag.readAuth()).toEqual(bundle);
    });

    it("second writeAuth overwrites the first", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.writeAuth({
        baseUrl: "https://old.example.com",
        token: "old-tok",
        deviceId: "dev-1",
        deviceName: "Old",
      });
      const next = {
        baseUrl: "https://new.example.com",
        token: "new-tok",
        deviceId: "dev-2",
        deviceName: "New",
      };
      await ag.writeAuth(next);
      expect(await ag.readAuth()).toEqual(next);
    });
  });

  describe("clearAuth", () => {
    it("clearAuth makes readAuth return null", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.writeAuth({
        baseUrl: "https://cc.example.com",
        token: "tok",
        deviceId: "dev-1",
        deviceName: "Phone",
      });
      await ag.clearAuth();
      expect(await ag.readAuth()).toBeNull();
    });

    it("clearAuth is safe when nothing stored", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await expect(ag.clearAuth()).resolves.toBeUndefined();
    });
  });

  describe("pushToMainOutbox / drainMainOutbox", () => {
    it("pushToMainOutbox appends an entry", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.pushToMainOutbox({
        id: "01JXABC123",
        kind: "text",
        body: "hello",
      });
      const entries = await ag.drainMainOutbox();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "01JXABC123", kind: "text", body: "hello" });
    });

    it("pushToMainOutbox appends multiple entries in order", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.pushToMainOutbox({ id: "id-1", kind: "text", body: "first" });
      await ag.pushToMainOutbox({ id: "id-2", kind: "link", body: "https://example.com" });
      const entries = await ag.drainMainOutbox();
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe("id-1");
      expect(entries[1].id).toBe("id-2");
    });

    it("drainMainOutbox clears the queue after reading", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.pushToMainOutbox({ id: "id-1", kind: "text", body: "hello" });
      await ag.drainMainOutbox();
      const second = await ag.drainMainOutbox();
      expect(second).toHaveLength(0);
    });

    it("drainMainOutbox returns empty array when nothing stored", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      expect(await ag.drainMainOutbox()).toEqual([]);
    });
  });

  describe("peekMainOutbox / clearMainOutbox (loss-proof drain primitives)", () => {
    it("peekMainOutbox returns entries without clearing the queue", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.pushToMainOutbox({ id: "id-1", kind: "text", body: "a" });
      await ag.pushToMainOutbox({ id: "id-2", kind: "link", body: "b" });

      const first = await ag.peekMainOutbox();
      expect(first).toHaveLength(2);
      expect(first[0]!.id).toBe("id-1");
      expect(first[1]!.id).toBe("id-2");

      // Queue still intact after peek
      const second = await ag.peekMainOutbox();
      expect(second).toHaveLength(2);
    });

    it("peekMainOutbox returns empty array when nothing stored", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      expect(await ag.peekMainOutbox()).toEqual([]);
    });

    it("clearMainOutbox removes all entries", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.pushToMainOutbox({ id: "id-1", kind: "text", body: "a" });
      await ag.clearMainOutbox();
      expect(await ag.peekMainOutbox()).toEqual([]);
    });

    it("clearMainOutbox is safe when nothing stored", async () => {
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await expect(ag.clearMainOutbox()).resolves.toBeUndefined();
    });

    it("peek → partial enqueue failure → clear → re-push simulates loss-proof drain", async () => {
      // This test exercises the handoff pattern used by SyncController.doWake():
      //   peek (no clear), process each entry, clear all, re-push failures.
      const shim = makeFakeShim();
      const ag = makeAppGroup(shim);
      await ag.pushToMainOutbox({ id: "id-1", kind: "text", body: "ok1" });
      await ag.pushToMainOutbox({ id: "id-2", kind: "text", body: "fail" });
      await ag.pushToMainOutbox({ id: "id-3", kind: "text", body: "ok3" });

      const mirrored = await ag.peekMainOutbox();
      const enqueued: string[] = [];
      const failed: typeof mirrored = [];
      for (const entry of mirrored) {
        if (entry.body === "fail") {
          failed.push(entry);
        } else {
          enqueued.push(entry.id);
        }
      }
      await ag.clearMainOutbox();
      for (const entry of failed) {
        await ag.pushToMainOutbox(entry);
      }

      // Entries 1 and 3 were processed; entry 2 survived in the mirror.
      expect(enqueued).toEqual(["id-1", "id-3"]);
      const remaining = await ag.peekMainOutbox();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe("id-2");
    });
  });
});
