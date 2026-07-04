import type { Device, HealthOut, Item, ItemKind, ItemsPage, LoginOut } from "../types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  clientVersion?: string;
  fetchFn?: typeof fetch;
  onAuthFailure?: () => void;
}

export class ApiClient {
  private token: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.token = opts.token;
    // Bind to globalThis so that storing the reference in an object property
    // does not lose the receiver — Chrome extension contexts throw
    // "Illegal invocation" if fetch is called without its Window receiver.
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  }

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (this.opts.clientVersion) headers["x-client-version"] = this.opts.clientVersion;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new NetworkError(String(err));
    }

    if (!res.ok) {
      let code = "unknown_error";
      let message = `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as { code?: string; message?: string };
        if (data.code) code = data.code;
        if (data.message) message = data.message;
      } catch {
        /* non-JSON error body — keep defaults */
      }
      if (res.status === 401) this.opts.onAuthFailure?.();
      throw new ApiError(res.status, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Root-level readiness + server identity — used by client onboarding.
   *  NOT under /api/v1 (Phase 1 decision 2). */
  async health(): Promise<HealthOut> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}/health`, { method: "GET" });
    } catch (err) {
      throw new NetworkError(String(err));
    }
    if (!res.ok) {
      let code = "unknown_error";
      let message = `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as { code?: string; message?: string };
        if (data.code) code = data.code;
        if (data.message) message = data.message;
      } catch {
        /* non-JSON body */
      }
      throw new ApiError(res.status, code, message);
    }
    return (await res.json()) as HealthOut;
  }

  register(email: string, password: string): Promise<{ user_id: string }> {
    return this.request("POST", "/auth/register", { email, password });
  }

  login(input: { email: string; password: string; device_name: string; platform: string }): Promise<LoginOut> {
    return this.request("POST", "/auth/login", input);
  }

  listItems(params: { cursor?: string; origin?: string; limit?: number } = {}): Promise<ItemsPage> {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.origin) q.set("origin", params.origin);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request("GET", `/items${qs ? `?${qs}` : ""}`);
  }

  createItem(input: { id?: string; kind: ItemKind; body: string; target_device_id?: string }): Promise<Item> {
    return this.request("POST", "/items", input);
  }

  deleteItem(id: string): Promise<void> {
    return this.request("DELETE", `/items/${id}`);
  }

  listDevices(): Promise<{ devices: Device[] }> {
    return this.request("GET", "/devices");
  }

  renameDevice(id: string, name: string): Promise<Device> {
    return this.request("PATCH", `/devices/${id}`, { name });
  }

  revokeDevice(id: string): Promise<void> {
    return this.request("DELETE", `/devices/${id}`);
  }
}
