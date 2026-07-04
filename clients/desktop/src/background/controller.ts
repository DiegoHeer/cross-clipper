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
import { broadcast } from "../shared/bridge";
import type {
  PendingSend,
  PopupRequest,
  StateSnapshot,
  WorkerEvent,
} from "../shared/messages";
import { capByBytes, detectKind } from "../shared/format";
import { FeedStore } from "./feedStore";
import { wsUrl } from "./socket";

export const CLIENT_VERSION = "0.1.0";
const AUTH_KEY = "cc.auth";
const DEVICES_KEY = "cc.devices";
const CURSOR_KEY = "cc.cursor";
const OUTBOX_KEY = "cc.outbox";
const PENDING_CANCELS_KEY = "cc.pendingCancels";

interface AuthState {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

/** Result type emitted to the Rust toast layer (wired in main.tsx Task 14). */
export interface CaptureResult {
  state: "synced" | "queued" | "sensitive" | "empty" | "unsupported" | "cancelled";
  snippet?: string;
  outboxId?: string;
}

export interface ControllerDeps {
  storage: SyncStorage;
  socketFactory: SocketFactory;
  fetchFn?: typeof fetch;
  /** Called for every new item received (badge / alert hook — wired Task 14). */
  onNewItem?: (item: Item) => void;
  /** Called with every capture result for the Rust toast window (wired Task 14). */
  onCaptureResult?: (r: CaptureResult) => void;
  /** Called when any window is opened/focused — clears the tray unread badge. */
  onWindowOpened?: () => void;
}

export class BackgroundController {
  private client: ApiClient | null = null;
  private engine: SyncEngine | null = null;
  private outbox: Outbox | null = null;
  private auth: AuthState | null = null;
  private feed: FeedStore;
  private feedReady: Promise<void> | null = null;
  private failed = new Map<string, PendingSend>();
  private status: SyncStatus = "stopped";
  private waking: Promise<void> | null = null;

  /**
   * Capture tracking for undo.
   * outboxIdToItemId: populated when outbox delivers (acked) → use for undo.
   * pendingCancelIds: outboxIds whose undo arrived before delivery; on
   *   delivery we immediately delete the server item.
   */
  private outboxIdToItemId = new Map<string, string>();
  private pendingCancelIds = new Set<string>();

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

  /** Idempotent boot — safe to call on every wakeup path. */
  wake(): Promise<void> {
    this.waking ??= this.doWake().finally(() => {
      this.waking = null;
    });
    return this.waking;
  }

  private async loadPendingCancels(): Promise<void> {
    const raw = await this.deps.storage.get(PENDING_CANCELS_KEY);
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
      for (const id of ids) this.pendingCancelIds.add(id);
    } catch {
      // ignore corrupt data
    }
  }

  private async savePendingCancels(): Promise<void> {
    await this.deps.storage.set(
      PENDING_CANCELS_KEY,
      JSON.stringify([...this.pendingCancelIds]),
    );
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
      onAuthFailure: () => void this.broadcastEvent({ type: "auth_required" }),
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
    // Load persisted cancel intents BEFORE outbox can flush so that any in-flight
    // entry from a previous session that delivers immediately after load is caught.
    await this.loadPendingCancels();
    await this.outbox.load();
    await this.engine.start();
    void this.outbox.flush();
  }

  // ---------------------------------------------------------------------------
  // Engine events
  // ---------------------------------------------------------------------------

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
          void this.broadcastEvent({ type: "item", item: e.item });
          this.deps.onNewItem?.(e.item);
        }
        break;
      case "item_deleted":
        if (await this.feed.remove(e.itemId)) {
          void this.broadcastEvent({ type: "item_deleted", itemId: e.itemId });
        }
        break;
      case "devices_changed":
        void this.broadcastEvent({ type: "devices", devices: await this.fetchDevices() });
        break;
      case "status":
        this.status = e.status;
        void this.broadcastEvent({ type: "status", status: e.status });
        break;
      case "auth_failed":
        void this.broadcastEvent({ type: "auth_required" });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Outbox events
  // ---------------------------------------------------------------------------

  private async onOutboxEvent(
    e:
      | { type: "delivered"; item: Item }
      | { type: "rejected"; entry: OutboxEntry; error: { message: string } }
      | { type: "auth_required" },
  ): Promise<void> {
    if (e.type === "delivered") {
      const outboxId = e.item.id; // server echoes the client-generated ULID as item id

      // Track the mapping for undo
      this.outboxIdToItemId.set(outboxId, e.item.id);

      // If undo arrived before delivery (in-flight race), delete immediately
      if (this.pendingCancelIds.has(outboxId)) {
        this.pendingCancelIds.delete(outboxId);
        this.outboxIdToItemId.delete(outboxId);
        void this.savePendingCancels();
        try {
          await this.client?.deleteItem(e.item.id);
        } catch {
          // best-effort; item will reconcile on next sync
        }
        void this.broadcastEvent({ type: "toast_update", outboxId, state: "cancelled" });
        return;
      }

      if (await this.feed.upsert(e.item)) {
        void this.broadcastEvent({ type: "item", item: e.item });
      }
      await this.broadcastOutbox();

      // Emit toast_update so the toast window knows the capture synced
      void this.broadcastEvent({ type: "toast_update", outboxId, state: "synced" });
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
      void this.broadcastEvent({ type: "auth_required" });
    }
  }

  // ---------------------------------------------------------------------------
  // Capture pipeline (decision 3/4)
  // ---------------------------------------------------------------------------

  /**
   * Handle a capture event from Rust (cc:capture).
   * Non-text kinds emit a result immediately with no server round-trip.
   * Text is normalized, capped, classified, and sent through the outbox untargeted.
   */
  async handleCapture(payload: {
    kind: "text" | "sensitive" | "empty" | "unsupported";
    text?: string;
  }): Promise<void> {
    if (payload.kind !== "text") {
      this.deps.onCaptureResult?.({ state: payload.kind });
      return;
    }

    if (!this.outbox) {
      // Not authenticated — report as if unsupported (no-op; user needs to log in)
      this.deps.onCaptureResult?.({ state: "unsupported" });
      return;
    }

    const raw = payload.text ?? "";
    const trimmed = raw.trim();
    const { body } = capByBytes(trimmed);
    const kind = detectKind(body);

    // Send untargeted (decision 3 — no target_device_id on speed path)
    const outboxId = await this.outbox.send(kind, body);
    await this.broadcastOutbox();

    // Determine if sync happened synchronously (outbox flushed inline)
    const stillPending = this.outbox.pending().some((e) => e.id === outboxId);
    const state = stillPending ? "queued" : "synced";
    const snippet = body.length > 60 ? body.slice(0, 60) + "…" : body;

    this.deps.onCaptureResult?.({ state, snippet, outboxId });
  }

  // ---------------------------------------------------------------------------
  // Request handler
  // ---------------------------------------------------------------------------

  async handleRequest(req: PopupRequest): Promise<unknown> {
    await this.wake();
    switch (req.type) {
      case "get_state":
        return this.snapshot();
      case "refresh":
        void this.fetchDevices().then((devices) =>
          this.broadcastEvent({ type: "devices", devices }),
        );
        void this.outbox?.flush();
        void this.broadcastEvent({ type: "snapshot", state: await this.snapshot() });
        return { ok: true };
      case "send": {
        if (!this.outbox) throw new Error("not authenticated");
        const outboxId = await this.outbox.send(
          req.kind,
          req.body,
          req.targetDeviceId ?? undefined,
        );
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
          void this.broadcastEvent({ type: "item_deleted", itemId: req.itemId });
        }
        return { ok: true };
      case "rename_device": {
        const device = await this.client!.renameDevice(req.deviceId, req.name);
        void this.broadcastEvent({ type: "devices", devices: await this.fetchDevices() });
        return device;
      }
      case "revoke_device":
        await this.client!.revokeDevice(req.deviceId);
        void this.broadcastEvent({ type: "devices", devices: await this.fetchDevices() });
        return { ok: true };
      case "undo_capture": {
        const itemId = this.outboxIdToItemId.get(req.outboxId);
        if (itemId) {
          // Already delivered — delete the server item
          this.outboxIdToItemId.delete(req.outboxId);
          try {
            await this.client?.deleteItem(itemId);
            if (await this.feed.remove(itemId)) {
              void this.broadcastEvent({ type: "item_deleted", itemId });
            }
          } catch {
            // best-effort
          }
        } else if (this.outbox && (await this.outbox.cancel(req.outboxId))) {
          // Still queued and not yet posted — removed locally, no server round-trip
          await this.broadcastOutbox();
          void this.broadcastEvent({
            type: "toast_update",
            outboxId: req.outboxId,
            state: "cancelled",
          });
          this.deps.onCaptureResult?.({ state: "cancelled", outboxId: req.outboxId });
        } else {
          // In-flight race: send is in progress — mark for cancellation on delivery
          this.pendingCancelIds.add(req.outboxId);
          void this.savePendingCancels();
        }
        return { ok: true };
      }
      case "window_opened":
        this.deps.onWindowOpened?.();
        return { ok: true };
      case "sign_out": {
        this.engine?.stop();
        this.outbox?.stop();
        this.engine = null;
        this.outbox = null;
        this.client = null;
        this.auth = null;
        this.failed.clear();
        this.outboxIdToItemId.clear();
        this.pendingCancelIds.clear();
        this.status = "stopped";
        await this.clearAuth();
        await this.feed.clear();
        // Decision 2: write sentinel "" / "[]" — no remove() on SyncStorage
        await this.deps.storage.set(CURSOR_KEY, "");
        await this.deps.storage.set(OUTBOX_KEY, "[]");
        await this.deps.storage.set(DEVICES_KEY, "[]");
        await this.deps.storage.set(PENDING_CANCELS_KEY, "[]");
        void this.broadcastEvent({ type: "snapshot", state: await this.snapshot() });
        return { ok: true };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
    void this.broadcastEvent({ type: "outbox_changed", pending: this.pendingList() });
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

  private broadcastEvent(e: WorkerEvent): Promise<void> {
    return broadcast(e);
  }
}
