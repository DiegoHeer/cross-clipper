# CrossClipper — System Design

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Scope:** Whole-system architecture. Each build phase (§10) gets its own spec and implementation plan.

## 1. Product summary

CrossClipper is a self-hosted, Pushbullet-like tool for sharing text (later: images and files) across a user's own devices: iOS, Android, Windows, and a browser extension.

A user self-hosts a single server (with attached storage), then connects clients to it via server URL + credentials. Each client shows:

- a **device list** of connected clients,
- a **feed** of shared items, filterable by origin device,
- a **compose box** to post text (later: attachments) to the feed,
- per-item actions: copy text; later, view thumbnails and download media on demand.

### Goals

- Personal daily-use tool: pragmatic, reliable, low-maintenance.
- Fully self-hosted core; the self-hosting experience is a product feature.
- Text-only MVP with a protocol and storage design that adds media without rework.
- Single-user MVP with a data model that makes multi-user a config flip, not a rewrite.

### Non-goals (explicit)

- **Automatic clipboard capture on mobile.** iOS forbids background clipboard access; Android 10+ heavily restricts it. Mobile is manual-first (share sheet / in-app compose). Desktop and only desktop gets auto-capture.
- **End-to-end encryption (MVP).** Trust model is TLS in transit + you own the server (standard self-hosted posture). True E2EE would break server-side thumbnails and add key-management UX; it is a potential protocol v2, not a bolt-on. This is stated so nobody assumes E2EE exists.
- **Cross-user messaging.** One user's devices talk to that user's feed. Multi-user means isolated accounts on one server, not user-to-user sends.
- **Targeted per-device sends.** The feed is broadcast-to-all-my-devices; the device list is a view filter, not an address book. Threading/addressing machinery is deliberately excluded (YAGNI) — revisit only if cross-user messaging ever becomes a goal.

## 2. Architecture overview

```
                        ┌─────────────────────────────┐
                        │        Self-hosted server    │
                        │  FastAPI (Python)            │
                        │  ├── REST API  (items, auth, │
                        │  │    devices, blobs)        │
                        │  ├── WebSocket hub (live)    │
                        │  ├── Push relay (APNs/FCM/   │
                        │  │    UnifiedPush)           │
                        │  ├── DB: SQLite → Postgres   │
                        │  └── Blob store: local FS →  │
                        │       S3-compatible          │
                        └──────────────┬──────────────┘
                                       │ HTTPS + WSS
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        │              │               │               │              │
  Browser ext     Windows app      iOS app        Android app    (future: CLI,
  (React, MV3)    (Tauri+React)   (React Native)  (React Native)  Linux, macOS)
        └──────────────┴───────┬───────┴───────────────┘
                               │
                    @crossclipper/core (shared TS package)
                    API client (OpenAPI-generated types),
                    WS reconnect/sync logic, local cache, models
```

### Monorepo layout

```
cross-clipper/
├── server/          # FastAPI app (Python, uv)
├── packages/
│   └── core/        # Shared TS: generated API types, sync engine, cache
├── clients/
│   ├── extension/   # Browser extension (MV3, React)
│   ├── desktop/     # Tauri + React (Windows first)
│   └── mobile/      # React Native (iOS + Android)
└── docs/            # Specs, ADRs
```

### Structural principles

1. **The wire protocol is the load-bearing wall.** Server and clients share a contract (OpenAPI schema), not code. `server/` emits `openapi.json`; a codegen step produces typed TS clients in `packages/core`. Server and clients evolve independently against the versioned contract.
2. **`packages/core` holds the intelligence; clients are thin.** Sync state machine, reconnect/backoff, cursor tracking, outbox/optimistic sends, and the local item cache are written once in core. Each client is UI + platform glue (clipboard access, share sheet, notifications). This is what makes four platforms tractable for a solo developer.
3. **Server is a modular monolith.** One FastAPI process, one Docker image, internal modules: `auth`, `items`, `devices`, `realtime`, `push`, `blobs`. No microservices.
4. **Storage starts embedded, scales by config.** SQLite + local filesystem blobs by default (zero-config self-hosting); Postgres + S3-compatible object storage as config options behind repository interfaces.

### Stack decisions and rationale

| Layer | Choice | Rationale |
|---|---|---|
| Server | Python + FastAPI | Owner's comfort zone → solo velocity; free OpenAPI schema → TS codegen; mature libs for APNs/FCM, S3, SQLAlchemy; workload is tiny (one user's devices) so performance is a non-factor |
| Shared client logic | TypeScript (`@crossclipper/core`) | One implementation of sync/caching for all four clients |
| Browser extension | React, Manifest V3 | Target platform; also fastest client to iterate on |
| Windows | Tauri + React | ~10 MB installer vs ~150 MB Electron; light Rust shell suits a 24/7 tray app |
| Mobile | React Native | iOS + Android from one codebase, reuses core + React knowledge |
| Types across the boundary | OpenAPI → generated TS | Recovers cross-language type safety without forcing a TS server |

Rejected alternatives: Node/TS server (native type sharing, but least-preferred backend language; codegen recovers the benefit), Rust/Axum server (best deployment binary, slower iteration), Flutter (covers 3 platforms but cannot produce a real browser extension), native per platform (4× work, unjustified for a personal tool).

## 3. Data model

```
User      { id, email, password_hash, created_at }
Device    { id, user_id → User, name, platform (ios|android|windows|extension|other),
            push_token?, push_transport? (apns|fcm|unifiedpush|none),
            last_seen_at, created_at, revoked_at? }
Item      { id (ULID), user_id → User, origin_device_id → Device,
            kind (text|link|image|file),
            body (text content or caption),
            blob_id? → Blob, created_at, deleted_at? }
Blob      { id, user_id, sha256, size, mime, storage_key,
            thumb_key?, created_at }
AuthToken { id, user_id, device_id, token_hash, expires_at, created_at }
```

Deliberate choices:

- **`user_id` on everything from day one.** Single-user MVP, but multi-user isolation later is a registration-toggle flip, not a migration.
- **ULIDs for item IDs.** Lexicographically sortable by creation time: feed ordering and sync cursors are `WHERE id > :cursor ORDER BY id`. No separate sequence column.
- **Soft delete with tombstones.** Deletions must sync; clients need to hear "item X is gone." `deleted_at` marks tombstones; the server prunes them after a retention window (default 30 days, configurable).
- **`kind` future-proofed now.** `image`/`file` are defined in the enum from day one; clients render unknown kinds as a graceful "unsupported item — update client" fallback, so adding media later doesn't break old clients.
- **`Blob` table exists day one, unused until the media phase.** The protocol slot (`blob_id`) is reserved so media is additive.
- **One token per device.** Revoking a device kills exactly that device's access. The UI device list is literally the `Device` table.

## 4. Wire protocol

All endpoints live under `/api/v1/`. Clients send their client version; the server can respond "client too old." With four clients updating at different speeds against a manually-upgraded server, version skew is guaranteed — the protocol makes it survivable.

### REST API

```
POST   /auth/register            (first-run only; locks after user exists — MVP)
POST   /auth/login               → { token, device_id }   (registers device in same call)
GET    /devices                  → list (name, platform, last_seen)
PATCH  /devices/{id}             (rename)
DELETE /devices/{id}             (revoke)

GET    /items?cursor=&origin=&limit=   → paginated feed (origin = device filter)
POST   /items                    { kind, body }            → Item
DELETE /items/{id}               (soft delete)

POST   /push/register            { transport, token }      (APNs/FCM/UnifiedPush)
GET    /health                   (readiness: DB reachable + blob dir writable)

# Media phase (designed now, built later):
POST   /blobs                    (upload) → { blob_id }, then POST /items with blob_id
GET    /blobs/{id}               (download), GET /blobs/{id}/thumb
```

### WebSocket (`/ws?token=…`)

Deliberately dumb — a notification channel, not a data channel:

```
server → client:  { type: "item_new",     item: {...} }
                  { type: "item_deleted", item_id }
                  { type: "device_changed" }
client → server:  { type: "ping" }   (keepalive)
```

### Sync model: pull-based with live nudges

The single most important reliability decision. The source of truth for catching up is always `GET /items?cursor=<last-seen ULID>`. On connect/reconnect, a client pulls everything after its cursor, then trusts WS events for real-time. If the WS hiccups, or a push wakes a backgrounded app, the recovery path is the same pull. One code path — implemented once in `packages/core` — covers cold start, reconnect, and push-wake. There is no state-machine edge where a missed WS event loses data.

### Push payloads carry no content

APNs/FCM messages are content-free wake signals ("something changed"). The client shows a local notification and pulls on open. Clipboard content never transits Apple/Google infrastructure.

## 5. Auth & security

### Flow (MVP)

1. First server run: `POST /auth/register` is open; create the single user. It then locks (403). Config flag `CC_ALLOW_REGISTRATION` re-opens it for the multi-user phase.
2. Client onboarding asks: **server URL, email, password, device name.** Login returns a long-lived, device-scoped, opaque bearer token.
3. Every request carries `Authorization: Bearer <token>`; the WS authenticates the same token at connect.

### In the MVP (cheap now, painful to retrofit)

- Login rate-limiting.
- Tokens hashed at rest; constant-time comparison.
- Item body size cap (default 256 KB, configurable).
- CORS locked to the extension origin.

### Deferred (consciously)

- **OAuth/OIDC.** `AuthToken` doesn't care how a token was minted; an OIDC path (e.g. behind Authelia/Keycloak for family use) is additive later.
- **E2EE.** See non-goals (§1). MVP trust model: TLS + you own the server.
- **TLS termination** is the deployment's job: server speaks HTTP behind a reverse proxy (Caddy/Traefik/nginx). Docs state "TLS in front, non-negotiable." Clients warn loudly on non-localhost/non-LAN `http://` URLs.

## 6. Clients

All four are React + `@crossclipper/core`, each ~"UI + platform glue," with the same three screens: **Feed** (global, filterable by origin device), **Compose** (input box; attach button in the media phase), **Devices/Settings**.

### Browser extension (reference client, built first)

- Manifest V3; Chrome/Edge/Firefox.
- Popup = feed + compose. Background service worker holds the WS and raises browser notifications.
- MV3 gotcha, designed-in: idle service workers are killed, dropping the WS. Harmless *because* sync is pull-with-nudges — on next wake the worker pulls from its cursor.
- Extras: context-menu "Send selection/link to CrossClipper"; per-item copy button.

### Windows (Tauri + React)

- The only client with real **auto-clipboard capture**: watches the OS clipboard and auto-posts new text (toggleable; per-app exclusions later).
- System tray, global hotkey to open the feed, native notifications with a "copy" action.

### iOS + Android (React Native)

- Manual-first by OS necessity: **share sheet → post to feed** is the primary send path; **feed → tap → copied** is the receive path.
- Push wake (APNs/FCM) shows a local notification. Android additionally gets a "Copy" notification action (impossible on iOS).
- Android optionally supports UnifiedPush for a Google-free setup; `Device.push_transport` already models it.

### The APNs reality

iOS background push requires an Apple developer account's APNs key; self-hosters cannot realistically bring their own. Standard pattern (as used by Home Assistant): the mobile apps are built against a small hosted relay endpoint — owned by the project (the owner's Apple developer account, planned for the near future) — that forwards **content-free wake pings** to APNs/FCM. Self-hosted purists can disable push entirely and rely on open-the-app pulls. This is the one unavoidable compromise in the fully-self-hosted story. Until the Apple account exists, iOS development proceeds in the simulator with WS-only delivery; push is a late phase regardless (§10).

## 7. Deployment & self-hosting

The self-hoster experience is a product feature.

```yaml
# docker-compose.yml — the entire deployment
services:
  crossclipper:
    image: ghcr.io/<owner>/crossclipper-server
    user: "1000:1000"                  # run as your host user — see permissions
    ports: ["8080:8080"]
    volumes: ["./data:/data"]          # SQLite DB + blobs live here
    environment:
      CC_SECRET_KEY: "..."             # the only required setting
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

- **Zero-config default:** SQLite + filesystem blobs under a single `/data` volume. Backup = copy the folder. `CC_DATABASE_URL` / `CC_BLOB_BACKEND=s3` upgrade to Postgres/S3 — same image, config only.
- **Healthcheck:** the image includes `curl` (Debian-slim base; a few MB, also useful for in-container debugging). `/health` verifies DB reachability and blob-dir writability, not merely process liveness, so the healthcheck is meaningful.
- **Data-folder permissions:**
  - The image never runs as root; it defaults to UID 1000, and the compose file documents `user: "UID:GID"` to match the host user, so files in `./data` are owned by the operator.
  - No chown-on-startup magic (the PUID/PGID entrypoint pattern requires starting as root). Instead, fail fast: if `/data` is not writable at boot, exit with `"/data is not writable by UID 1000 — run: chown -R 1000:1000 ./data or set user: in compose"` rather than half-starting.
  - Everything lives under one `/data` root (`/data/db.sqlite`, `/data/blobs/`): one directory to get right, back up, restore.
- **All config via `CC_*` env vars** (12-factor), documented in one table: registration toggle, item size cap, tombstone retention, push relay on/off, CORS origins, DB/blob backends.
- **Observability:** `/health` for uptime monitoring; structured JSON logs.
- **Client distribution (later phases):** extension via Chrome/Firefox stores; Windows installer via GitHub Releases; mobile via TestFlight/Play Store once the Apple developer account exists.

## 8. Error handling

The spine lives in `packages/core`, written once:

- **Offline-first sends.** Compose → item enters a local outbox → POST with retry/backoff → reconciled into the feed on ack. Airplane-mode sends deliver later. Client-generated ULIDs double as idempotency keys, making retries duplicate-safe.
- **Reconnect discipline.** WS drops are normal (MV3 worker kills, phone sleep). Reconnect with jittered backoff; always re-pull from cursor before trusting live events.
- **Auth failures.** 401 → one re-auth prompt; never a retry loop hammering the server.
- **Server errors.** Every error is structured `{ code, message }`. Unknown `kind`, oversized bodies, and revoked devices are rejected with codes clients can render meaningfully.

## 9. Testing strategy

| Layer | Framework | Focus |
|---|---|---|
| Server | pytest | Deepest suite: API contract tests against a real temp SQLite DB; WS hub tests; auth + rate-limit tests. The OpenAPI schema snapshot is itself a test — contract drift fails CI and forces client-type regeneration. |
| `packages/core` | vitest | Sync engine vs a mocked server: reconnect scenarios, cursor gaps, outbox retries, dedup. Reliability bugs would live here, so it gets the most scenario coverage. |
| Clients | per-platform | Thin by design → component tests plus one happy-path E2E each (extension via Playwright; desktop/mobile manual smoke initially — honest solo-dev capacity). |

## 10. Build order

Each phase is its own spec → plan → implementation cycle and ends with something usable:

1. **Server + protocol + `core`.** FastAPI MVP (auth, items, devices, WS), OpenAPI→TS codegen pipeline, sync engine in `core` with scenario tests. Usable via a throwaway CLI.
2. **Browser extension** (reference client). First real UI; proves `core` on a real platform. Product becomes daily-usable across browsers/machines.
3. **Windows (Tauri).** Tray, global hotkey, auto-clipboard watcher — the flagship "it just syncs" experience.
4. **React Native app.** Share sheet + feed; WS-only delivery at first.
5. **Push delivery.** APNs/FCM wake relay (requires the Apple developer account), Android notification actions, UnifiedPush option.
6. **Media phase.** Blob upload/download, thumbnails, attach UX. Protocol already reserved the slots.
7. **Multi-user flip.** `CC_ALLOW_REGISTRATION=true`, per-user isolation verified end-to-end (the data model carried it from day one).

## 11. Open questions (for later phases, not blockers)

- Hosted push relay operational details (rate limits, abuse prevention) — decide in phase 5.
- Feed retention policy for items themselves (keep forever vs. configurable cap) — default keep-forever in MVP; revisit if `/data` growth becomes a complaint.
- Browser-extension auto-clipboard capture (Chrome offscreen-document tricks exist but are fragile) — explicitly out of MVP; desktop owns auto-capture.
