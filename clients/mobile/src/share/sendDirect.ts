/**
 * sendDirect.ts — Share extension direct send (Task 13, decision 7).
 *
 * Builds its OWN ApiClient from the App Group token. No SyncEngine / Outbox
 * in the extension process — a single POST with a client-generated ULID as the
 * idempotency key.
 *
 * On failure (network error or server error):
 * - Pushes the SAME ULID to the App Group outbox mirror so the main app's
 *   Outbox can retry with createItem({id: entry.id, ...}).
 * - Server ULID idempotency (system spec §8) makes this double-send-safe even
 *   if the extension's POST actually reached the server.
 */
import { ApiClient } from "@crossclipper/core";
import { ulid } from "ulidx";
import type { AppGroup } from "../platform/appGroup";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendDirectDeps {
  baseUrl: string;
  token: string;
  appGroup: AppGroup;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface SendDirectInput {
  kind: "text" | "link";
  body: string;
  targetDeviceId?: string;
}

export type SendDirectResult =
  | { status: "sent"; item: object }
  | { status: "queued"; retryHint: string };

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Attempt to POST a new item directly to the server.
 *
 * The client ULID is generated ONCE before the POST and reused in the outbox
 * mirror entry on failure — never regenerated.
 */
export async function sendDirect(
  deps: SendDirectDeps,
  input: SendDirectInput,
): Promise<SendDirectResult> {
  const client = new ApiClient({
    baseUrl: deps.baseUrl,
    token: deps.token,
    fetchFn: deps.fetchFn,
  });

  // Generate the idempotency key ONCE — must be the same in POST and mirror.
  const id = ulid();

  try {
    const item = await client.createItem({
      id,
      kind: input.kind,
      body: input.body,
      ...(input.targetDeviceId ? { target_device_id: input.targetDeviceId } : {}),
    });
    return { status: "sent", item };
  } catch {
    // Push the SAME id to the outbox mirror — the critical handoff.
    await deps.appGroup.pushToMainOutbox({
      id,
      kind: input.kind,
      body: input.body,
      ...(input.targetDeviceId ? { targetDeviceId: input.targetDeviceId } : {}),
    });
    return {
      status: "queued",
      retryHint: "Couldn't send — open app to retry",
    };
  }
}
