import {
  ApiClient,
  Outbox,
  SyncEngine,
  type Device,
  type Item,
  type OutboxEntry,
  type SocketFactory,
  type SyncStatus,
  type SyncStorage,
} from "@crossclipper/core";
import type { PendingSend, PopupRequest, StateSnapshot, WorkerEvent } from "../shared/messages";
import { FeedStore } from "./feedStore";
import { wsUrl } from "./socket";

export const CLIENT_VERSION = "0.1.0";
const AUTH_KEY = "cc.auth";
const DEVICES_KEY = "cc.devices";
const CURSOR_KEY = "cc.cursor";
const OUTBOX_KEY = "cc.outbox";

interface AuthState {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

export interface ControllerDeps {
  storage: SyncStorage;
  socketFactory: SocketFactory;
  fetchFn?: typeof fetch;
  onNewItem?: (item: Item) => void;
}

interface PortLike {
  name: string;
  postMessage(m: unknown): void;
  onDisconnect: { addListener(fn: () => void): void };
}

export class BackgroundController {
  private client: ApiClient | null = null;
  private engine: SyncEngine | null = null;
  private outbox: Outbox | null = null;
  private auth: AuthState | null = null;
  private feed: FeedStore;
  private feedReady: Promise<void> | null = null;
  private ports = new Set<PortLike>();
  private failed = new Map<string, PendingSend>();
  private status: SyncStatus = "stopped";
  private waking: Promise<void> | null = null;

  /** Badge-clear hook; installed by the alerts wiring (Task 18). */
  onPopupOpened?: () => void;

  constructor(private readonly deps: ControllerDeps) {
    this.feed = new FeedStore(deps.storage);
  }

  private ensureFeed(): Promise<void> {
    this.feedReady ??= this.feed.init();
    return this.feedReady;
  }

  private async loadAuth(): Promise<AuthState | null> {
    const raw = await this.deps.storage.get(AUTH_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthState;
    } catch {
      return null;
    }
  }

  private async clearAuth(): Promise<void> {
    await this.deps.storage.set(AUTH_KEY, "");
  }

  /** Idempotent boot — safe to call on every MV3 wake path. */
  wake(): Promise<void> {
    this.waking ??= this.doWake().finally(() => {
      this.waking = null;
    });
    return this.waking;
  }

  private async doWake(): Promise<void> {
    await this.ensureFeed();
    if (this.engine) {
      void this.outbox?.flush();
      return;
    }
    this.auth = await this.loadAuth();
    if (!this.auth) return;
    const { baseUrl, token } = this.auth;

    this.client = new ApiClient({
      baseUrl,
      token,
      clientVersion: CLIENT_VERSION,
      fetchFn: this.deps.fetchFn,
      onAuthFailure: () => this.broadcast({ type: "auth_required" }),
    });

    this.engine = new SyncEngine({
      client: this.client,
      storage: this.deps.storage,
      socketFactory: this.deps.socketFactory,
      wsUrl: () => wsUrl(baseUrl, token),
    });
    this.engine.onEvent((e) => void this.onEngineEvent(e));

    this.outbox = new Outbox({
      client: this.client,
      storage: this.deps.storage,
      onEvent: (e) => void this.onOutboxEvent(e),
    });
    await this.outbox.load();
    await this.engine.start();
    void this.outbox.flush();
  }

  private async onEngineEvent(
    e:
      | { type: "item"; item: Item }
      | { type: "item_deleted"; itemId: string }
      | { type: "devices_changed" }
      | { type: "status"; status: SyncStatus }
      | { type: "auth_failed" },
  ): Promise<void> {
    switch (e.type) {
      case "item":
        if (await this.feed.upsert(e.item)) {
          this.broadcast({ type: "item", item: e.item });
          this.deps.onNewItem?.(e.item);
        }
        break;
      case "item_deleted":
        if (await this.feed.remove(e.itemId)) {
          this.broadcast({ type: "item_deleted", itemId: e.itemId });
        }
        break;
      case "devices_changed":
        this.broadcast({ type: "devices", devices: await this.fetchDevices() });
        break;
      case "status":
        this.status = e.status;
        this.broadcast({ type: "status", status: e.status });
        break;
      case "auth_failed":
        this.broadcast({ type: "auth_required" });
        break;
    }
  }

  private async onOutboxEvent(
    e:
      | { type: "delivered"; item: Item }
      | { type: "rejected"; entry: OutboxEntry; error: { message: string } }
      | { type: "auth_required" },
  ): Promise<void> {
    if (e.type === "delivered") {
      if (await this.feed.upsert(e.item)) this.broadcast({ type: "item", item: e.item });
      await this.broadcastOutbox();
    } else if (e.type === "rejected") {
      this.failed.set(e.entry.id, {
        id: e.entry.id,
        kind: e.entry.kind,
        body: e.entry.body,
        targetDeviceId: e.entry.target_device_id ?? null,
        failed: true,
        errorMessage: e.error.message,
      });
      await this.broadcastOutbox();
    } else {
      this.broadcast({ type: "auth_required" });
    }
  }

  private pendingList(): PendingSend[] {
    const queued = (this.outbox?.pending() ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      targetDeviceId: e.target_device_id ?? null,
      failed: false,
    }));
    return [...this.failed.values(), ...queued];
  }

  private async broadcastOutbox(): Promise<void> {
    this.broadcast({ type: "outbox_changed", pending: this.pendingList() });
  }

  private async fetchDevices(): Promise<Device[]> {
    try {
      const { devices } = await this.client!.listDevices();
      await this.deps.storage.set(DEVICES_KEY, JSON.stringify(devices));
      return devices;
    } catch {
      return JSON.parse((await this.deps.storage.get(DEVICES_KEY)) ?? "[]") as Device[];
    }
  }

  async snapshot(): Promise<StateSnapshot> {
    await this.ensureFeed();
    const cachedDevices = JSON.parse(
      (await this.deps.storage.get(DEVICES_KEY)) ?? "[]",
    ) as Device[];
    return {
      authed: this.auth !== null,
      baseUrl: this.auth?.baseUrl ?? null,
      deviceId: this.auth?.deviceId ?? null,
      status: this.status,
      items: this.feed.list(),
      pending: this.pendingList(),
      devices: cachedDevices,
    };
  }

  async handleRequest(req: PopupRequest): Promise<unknown> {
    await this.wake();
    switch (req.type) {
      case "get_state":
        return this.snapshot();
      case "refresh":
        void this.fetchDevices().then((devices) => this.broadcast({ type: "devices", devices }));
        void this.outbox?.flush();
        return { ok: true };
      case "send": {
        if (!this.outbox) throw new Error("not authenticated");
        const outboxId = await this.outbox.send(req.kind, req.body, req.targetDeviceId ?? undefined);
        await this.broadcastOutbox();
        return { outboxId };
      }
      case "retry": {
        const failed = this.failed.get(req.outboxId);
        if (failed && this.outbox) {
          this.failed.delete(req.outboxId);
          await this.outbox.send(failed.kind, failed.body, failed.targetDeviceId ?? undefined);
          await this.broadcastOutbox();
        }
        return { ok: true };
      }
      case "delete_item":
        await this.client?.deleteItem(req.itemId);
        if (await this.feed.remove(req.itemId)) {
          this.broadcast({ type: "item_deleted", itemId: req.itemId });
        }
        return { ok: true };
      case "rename_device": {
        const device = await this.client!.renameDevice(req.deviceId, req.name);
        this.broadcast({ type: "devices", devices: await this.fetchDevices() });
        return device;
      }
      case "revoke_device":
        await this.client!.revokeDevice(req.deviceId);
        this.broadcast({ type: "devices", devices: await this.fetchDevices() });
        return { ok: true };
      case "sign_out": {
        this.engine?.stop();
        this.outbox?.stop();
        this.engine = null;
        this.outbox = null;
        this.client = null;
        this.auth = null;
        this.failed.clear();
        this.status = "stopped";
        await this.clearAuth();
        await this.feed.clear();
        // Reset sync state. Prefer remove() (ExtensionStorage) over writing
        // empty strings so cursor is truly absent after sign-out.
        const storage = this.deps.storage as SyncStorage & { remove?(k: string): Promise<void> };
        if (storage.remove) {
          await storage.remove(CURSOR_KEY);
          await storage.remove(OUTBOX_KEY);
          await storage.remove(DEVICES_KEY);
        } else {
          await this.deps.storage.set(OUTBOX_KEY, "[]");
          await this.deps.storage.set(DEVICES_KEY, "[]");
          // Cursor left as-is (absent); engine re-syncs from scratch on next wake.
        }
        this.broadcast({ type: "snapshot", state: await this.snapshot() });
        return { ok: true };
      }
    }
  }

  async onPortConnect(port: PortLike): Promise<void> {
    this.ports.add(port);
    port.onDisconnect.addListener(() => this.ports.delete(port));
    port.postMessage({ type: "snapshot", state: await this.snapshot() } satisfies WorkerEvent);
    this.onPopupOpened?.();
    void this.wake();
  }

  private broadcast(e: WorkerEvent): void {
    for (const port of this.ports) port.postMessage(e);
  }
}
