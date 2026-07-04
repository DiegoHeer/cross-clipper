/**
 * SyncController — mobile adaptation of the extension BackgroundController.
 *
 * Glue only: wires one ApiClient + SyncEngine + Outbox from @crossclipper/core
 * via the merged platform adapters. All sync semantics live in core.
 *
 * AppState lifecycle:
 *   active → wake()  (engine start + outbox flush)
 *   background | inactive → sleep()  (engine stop + outbox stop)
 *
 * Architectural rule: NO sync logic here. The one recovery path is core's
 * cursor pull on engine.start().
 */
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
import type { AppStateStatus } from "react-native";
import { FeedStore } from "./feedStore";
import { wsUrl } from "../platform/socket";

export const CLIENT_VERSION = "0.1.0";
const AUTH_KEY = "cc.auth";
const DEVICES_KEY = "cc.devices";
const OUTBOX_KEY = "cc.outbox";

interface AuthState {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

/** Injectable AppState-like for testing. */
export type AppStateLike = {
  currentState: AppStateStatus;
  addEventListener(
    event: "change",
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
};

export interface SyncControllerDeps {
  storage: SyncStorage;
  socketFactory: SocketFactory;
  fetchFn?: typeof fetch;
  /** Injectable for testing; defaults to RN AppState. */
  appState?: AppStateLike;
}

export interface SyncSnapshot {
  status: SyncStatus;
  items: Item[];
  devices: Device[];
  /** Outbox ids currently pending delivery. */
  pendingIds: string[];
  /** Outbox ids that failed (rejected 4xx). */
  failedIds: string[];
  authRequired: boolean;
}

export class SyncController {
  private client: ApiClient | null = null;
  private engine: SyncEngine | null = null;
  private outbox: Outbox | null = null;
  private auth: AuthState | null = null;
  private feed: FeedStore;
  private feedReady: Promise<void> | null = null;
  private devices: Device[] = [];
  private failed = new Map<string, OutboxEntry>();
  private status: SyncStatus = "stopped";
  private waking: Promise<void> | null = null;
  private authRequired = false;
  private listeners: Array<() => void> = [];

  constructor(private readonly deps: SyncControllerDeps) {
    this.feed = new FeedStore(deps.storage);
  }

  // ─── Feed init ──────────────────────────────────────────────────────────────

  private ensureFeed(): Promise<void> {
    this.feedReady ??= this.feed.init();
    return this.feedReady;
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private async loadAuth(): Promise<AuthState | null> {
    const raw = await this.deps.storage.get(AUTH_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthState;
    } catch {
      return null;
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Idempotent boot — safe to call on every AppState active transition. */
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
      onAuthFailure: () => {
        this.authRequired = true;
        this.emit();
      },
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

  /** Stop the engine and outbox (e.g. app backgrounded). */
  sleep(): void {
    this.engine?.stop();
    this.outbox?.stop();
    this.engine = null;
    this.outbox = null;
    this.client = null;
    this.status = "stopped";
    this.emit();
  }

  /** Subscribe to RN AppState change events. */
  attachAppState(appState?: AppStateLike): void {
    const as = appState ?? this.deps.appState;
    if (!as) return;
    as.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void this.wake();
      } else if (nextState === "background" || nextState === "inactive") {
        this.sleep();
      }
    });
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  /** Enqueue a send via Outbox. Returns the outbox entry id (client ULID). */
  async send(
    kind: "text" | "link",
    body: string,
    targetDeviceId?: string,
  ): Promise<string> {
    if (!this.outbox) throw new Error("not authenticated");
    const id = await this.outbox.send(kind, body, targetDeviceId);
    this.emit();
    return id;
  }

  /**
   * Delete an item: call ApiClient.deleteItem + record local tombstone.
   * Tombstone ensures a cursor re-pull cannot resurrect the item.
   */
  async remove(id: string): Promise<void> {
    await this.client?.deleteItem(id);
    await this.feed.remove(id);
    this.emit();
  }

  // ─── Snapshot ───────────────────────────────────────────────────────────────

  snapshot(): SyncSnapshot {
    return {
      status: this.status,
      items: this.feed.list(),
      devices: [...this.devices],
      pendingIds: (this.outbox?.pending() ?? []).map((e) => e.id),
      failedIds: [...this.failed.keys()],
      authRequired: this.authRequired,
    };
  }

  onChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  // ─── Event handlers ─────────────────────────────────────────────────────────

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
        await this.feed.upsert(e.item);
        this.emit();
        break;
      case "item_deleted":
        await this.feed.remove(e.itemId);
        this.emit();
        break;
      case "devices_changed":
        this.devices = await this.fetchDevices();
        this.emit();
        break;
      case "status":
        this.status = e.status;
        this.emit();
        break;
      case "auth_failed":
        this.authRequired = true;
        this.emit();
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
      await this.feed.upsert(e.item);
      this.emit();
    } else if (e.type === "rejected") {
      this.failed.set(e.entry.id, e.entry);
      this.emit();
    } else {
      // auth_required from outbox
      this.authRequired = true;
      this.emit();
    }
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

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
