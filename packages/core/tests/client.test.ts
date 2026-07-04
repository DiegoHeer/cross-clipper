import { describe, expect, it, vi } from "vitest";

import { ApiClient, ApiError, NetworkError } from "../src/api/client";
import type { HealthOut } from "../src";

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("ApiClient", () => {
  it("sends bearer token, client version and correct URL", async () => {
    const fetchFn = vi.fn(async () => json(200, { items: [], next_cursor: null }));
    const client = new ApiClient({
      baseUrl: "http://srv", token: "tok-1", clientVersion: "0.1.0",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.listItems({ cursor: "01A", limit: 50 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("http://srv/api/v1/items?cursor=01A&limit=50");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok-1");
    expect(headers.get("x-client-version")).toBe("0.1.0");
  });

  it("maps {code,message} error bodies to ApiError", async () => {
    const fetchFn = async () => json(413, { code: "item_too_large", message: "too big" });
    const client = new ApiClient({ baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch });
    const err = await client.createItem({ kind: "text", body: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(413);
    expect(err.code).toBe("item_too_large");
  });

  it("wraps transport failures in NetworkError", async () => {
    const fetchFn = async () => { throw new TypeError("fetch failed"); };
    const client = new ApiClient({ baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch });
    await expect(client.listItems()).rejects.toBeInstanceOf(NetworkError);
  });

  it("fires onAuthFailure on 401 and still throws", async () => {
    const onAuthFailure = vi.fn();
    const fetchFn = async () => json(401, { code: "invalid_token", message: "nope" });
    const client = new ApiClient({
      baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch, onAuthFailure,
    });
    await expect(client.listItems()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("handles 204 responses", async () => {
    const fetchFn = async () => new Response(null, { status: 204 });
    const client = new ApiClient({ baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch });
    await expect(client.deleteItem("01A")).resolves.toBeUndefined();
  });
});

describe("health", () => {
  it("GETs root /health without the /api/v1 prefix", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ status: "ok", app: "crossclipper", version: "0.1.0", registration_open: true }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new ApiClient({ baseUrl: "http://s", fetchFn });
    const out: HealthOut = await client.health();
    expect(calls).toEqual(["http://s/health"]);
    expect(out.app).toBe("crossclipper");
    expect(out.registration_open).toBe(true);
  });

  it("maps transport failure to NetworkError and 503 to ApiError", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(new ApiClient({ baseUrl: "http://s", fetchFn: boom }).health()).rejects.toBeInstanceOf(
      NetworkError,
    );
    const sick = (async () =>
      new Response(JSON.stringify({ code: "unhealthy", message: "db" }), { status: 503 })) as typeof fetch;
    await expect(new ApiClient({ baseUrl: "http://s", fetchFn: sick }).health()).rejects.toMatchObject({
      status: 503,
      code: "unhealthy",
    });
  });
});
