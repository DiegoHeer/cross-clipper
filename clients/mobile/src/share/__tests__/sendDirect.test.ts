/**
 * sendDirect.test.ts — Task 13 TDD step 1 (failing → pass after implementation).
 *
 * Uses a fake fetch (injectable). Critically asserts that the ULID passed to
 * pushToMainOutbox() equals the id sent in the failed POST body — the
 * load-bearing idempotency handoff (system spec §8).
 */
import { sendDirect } from "../sendDirect";
import type { AppGroupShim } from "../../platform/appGroup";
import { makeAppGroup } from "../../platform/appGroup";

// ─── Fake App Group shim ──────────────────────────────────────────────────────

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

// ─── Fake fetch helpers ───────────────────────────────────────────────────────

function fakeItem(id: string) {
  return {
    id,
    kind: "text",
    body: "hello",
    created_at: "2026-01-01T00:00:00Z",
    sync_seq: 1,
    deleted_at: null,
    origin_device_id: "dev-1",
    target_device_id: null,
  };
}

/** Create a fetch mock that succeeds with a given JSON body. */
function makeSuccessFetch(responseBody: unknown): typeof fetch {
  return jest.fn().mockImplementation(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      void _url;
      void init;
      return {
        ok: true,
        status: 201,
        json: async () => responseBody,
      } as Response;
    },
  ) as unknown as typeof fetch;
}

/** Create a fetch mock that captures the POST body and succeeds. */
function makeCapturingFetch(
  capture: { body: Record<string, unknown> | null },
  responseBody: unknown,
): typeof fetch {
  return jest.fn().mockImplementation(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        capture.body = JSON.parse(init.body as string) as Record<string, unknown>;
      }
      return {
        ok: true,
        status: 201,
        json: async () => responseBody,
      } as Response;
    },
  ) as unknown as typeof fetch;
}

/** Create a fetch mock that throws a network error after capturing the POST body. */
function makeFailFetch(
  capture: { id: string | undefined },
): typeof fetch {
  return jest.fn().mockImplementation(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        capture.id = body.id as string;
      }
      throw new Error("Network failure");
    },
  ) as unknown as typeof fetch;
}

/** Create a fetch mock that returns a server error. */
function makeServerErrorFetch(): typeof fetch {
  return jest.fn().mockImplementation(async () => {
    return {
      ok: false,
      status: 500,
      json: async () => ({ code: "server_error", message: "Internal Server Error" }),
    } as Response;
  }) as unknown as typeof fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sendDirect", () => {
  const BASE_URL = "https://cc.example.com";
  const TOKEN = "tok-abc";

  it("resolves with the created item on success", async () => {
    const shim = makeFakeShim();
    const ag = makeAppGroup(shim);
    const fetchFn = makeSuccessFetch(fakeItem("01JXTEST"));

    const result = await sendDirect(
      { baseUrl: BASE_URL, token: TOKEN, appGroup: ag, fetchFn },
      { kind: "text", body: "hello" },
    );

    expect(result.status).toBe("sent");
    if (result.status === "sent") {
      expect(result.item).toMatchObject({ id: "01JXTEST", body: "hello" });
    }
  });

  it("includes target_device_id in POST when provided", async () => {
    const shim = makeFakeShim();
    const ag = makeAppGroup(shim);
    const capture = { body: null as Record<string, unknown> | null };
    const fetchFn = makeCapturingFetch(capture, fakeItem("01JXTEST"));

    await sendDirect(
      { baseUrl: BASE_URL, token: TOKEN, appGroup: ag, fetchFn },
      { kind: "text", body: "hello", targetDeviceId: "dev-other" },
    );

    expect(capture.body?.target_device_id).toBe("dev-other");
  });

  it("sends a client-ULID as id in the POST body", async () => {
    const shim = makeFakeShim();
    const ag = makeAppGroup(shim);
    const capture = { body: null as Record<string, unknown> | null };
    const fetchFn = makeCapturingFetch(capture, fakeItem("placeholder"));

    await sendDirect(
      { baseUrl: BASE_URL, token: TOKEN, appGroup: ag, fetchFn },
      { kind: "text", body: "hello" },
    );

    // ULID is 26 chars, all Crockford base32
    expect(typeof capture.body?.id).toBe("string");
    expect(capture.body?.id as string).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("on network failure: calls pushToMainOutbox with the SAME id as the failed POST", async () => {
    // This is the load-bearing idempotency assertion.
    // The ULID generated for the POST attempt must be the same one stored
    // in the outbox mirror so the main app's createItem reuses it.
    const shim = makeFakeShim();
    const ag = makeAppGroup(shim);
    const capture = { id: undefined as string | undefined };
    const fetchFn = makeFailFetch(capture);

    const result = await sendDirect(
      { baseUrl: BASE_URL, token: TOKEN, appGroup: ag, fetchFn },
      { kind: "text", body: "hello" },
    );

    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.retryHint).toMatch(/open app/i);
    }

    // The outbox mirror must contain the same ULID that was in the POST
    const entries = await ag.drainMainOutbox();
    expect(entries).toHaveLength(1);

    // THE CRITICAL ASSERTION: same ULID used in POST and in outbox entry
    expect(entries[0].id).toBe(capture.id);
  });

  it("on network failure: pushToMainOutbox entry contains kind and body", async () => {
    const shim = makeFakeShim();
    const ag = makeAppGroup(shim);
    const capture = { id: undefined as string | undefined };
    const fetchFn = makeFailFetch(capture);

    await sendDirect(
      { baseUrl: BASE_URL, token: TOKEN, appGroup: ag, fetchFn },
      { kind: "link", body: "https://example.com", targetDeviceId: "dev-other" },
    );

    const entries = await ag.drainMainOutbox();
    expect(entries[0]).toMatchObject({
      kind: "link",
      body: "https://example.com",
      targetDeviceId: "dev-other",
    });
  });

  it("on server error: calls pushToMainOutbox fallback", async () => {
    const shim = makeFakeShim();
    const ag = makeAppGroup(shim);
    const fetchFn = makeServerErrorFetch();

    const result = await sendDirect(
      { baseUrl: BASE_URL, token: TOKEN, appGroup: ag, fetchFn },
      { kind: "text", body: "hello" },
    );

    expect(result.status).toBe("queued");
    const entries = await ag.drainMainOutbox();
    expect(entries).toHaveLength(1);
  });
});
