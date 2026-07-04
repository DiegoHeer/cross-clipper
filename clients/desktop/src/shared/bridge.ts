import { emit, listen } from "@tauri-apps/api/event";
import { isPopupRequest, isWorkerEvent } from "./messages";
import type { PopupRequest, WorkerEvent } from "./messages";
import { EVT_EVENT, REQ_EVENT, REPLY_EVENT } from "./messages";

// ---------------------------------------------------------------------------
// Types for wire payloads
// ---------------------------------------------------------------------------
interface RequestEnvelope {
  id: string;
  req: PopupRequest;
}

interface ReplyEnvelope {
  id: string;
  result: unknown;
}

// ---------------------------------------------------------------------------
// Renderer side
// ---------------------------------------------------------------------------

/**
 * Subscribe to WorkerEvents broadcast by the background window.
 * Returns an unlisten callback (mirrors the Tauri listen return value).
 * Malformed payloads are silently dropped.
 */
export async function subscribeEvents(
  cb: (e: WorkerEvent) => void,
): Promise<() => void> {
  return listen(EVT_EVENT, ({ payload }) => {
    if (isWorkerEvent(payload)) cb(payload);
  });
}

/**
 * Send a PopupRequest to the background window and await the correlated reply.
 * Times out after 10 seconds.
 */
export async function requestBackground<T = unknown>(
  req: PopupRequest,
): Promise<T> {
  const id = crypto.randomUUID();
  const pending = new Map<string, (v: unknown) => void>();

  const unlistenReply = await listen(REPLY_EVENT, ({ payload }) => {
    const env = payload as ReplyEnvelope;
    if (env && typeof env === "object" && env.id === id) {
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(env.result);
      }
    }
  });

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      unlistenReply();
      reject(new Error(`requestBackground timed out for request id ${id}`));
    }, 10_000);

    pending.set(id, (result) => {
      clearTimeout(timeout);
      unlistenReply();
      resolve(result as T);
    });

    void emit(REQ_EVENT, { id, req } satisfies RequestEnvelope);
  });
}

// ---------------------------------------------------------------------------
// Background window side
// ---------------------------------------------------------------------------

/**
 * Listen for incoming PopupRequests, run the handler, and emit the
 * correlated reply. Returns an unlisten callback.
 * Malformed payloads (non-PopupRequest) are silently dropped.
 */
export async function serveRequests(
  handler: (req: PopupRequest) => Promise<unknown>,
): Promise<() => void> {
  return listen(REQ_EVENT, ({ payload }) => {
    const env = payload as RequestEnvelope;
    if (
      !env ||
      typeof env !== "object" ||
      typeof env.id !== "string" ||
      !isPopupRequest(env.req)
    ) {
      return;
    }
    void handler(env.req).then((result) => {
      void emit(REPLY_EVENT, { id: env.id, result } satisfies ReplyEnvelope);
    });
  });
}

/**
 * Broadcast a WorkerEvent to all renderer windows.
 */
export async function broadcast(e: WorkerEvent): Promise<void> {
  await emit(EVT_EVENT, e);
}
