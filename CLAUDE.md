# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

CrossClipper: a self-hosted, Pushbullet-like tool for sharing text (later: images/files) across one user's devices — iOS, Android, Windows, and a browser extension — backed by a single self-hosted server.

**Current state: design phase.** No code exists yet. The specs in `docs/superpowers/specs/` are the source of truth and MUST be read before any design or implementation work:

- `2026-07-03-cross-clipper-design.md` — whole-system architecture, data model, wire protocol, build order (§10)
- `2026-07-03-extension-client-design.md` — browser extension (Phase 2), including the validated UI decisions and design-token contract for all clients

Implementation plans live in `docs/superpowers/plans/`. Work proceeds phase-by-phase per §10 of the system spec: each phase gets its own spec → plan → implementation cycle.

## Process conventions (project-specific)

- **Implementation is executed via subagents** (superpowers:subagent-driven-development), keeping the main session free for design work.
- Specs and plans are reviewed by Diego before implementation starts; nothing is implemented without an approved plan.
- UI design decisions are made via visual mockups (brainstorming visual companion, sessions in `.superpowers/` — gitignored). Decisions and their rejected alternatives are recorded in the client specs.

## Architecture (read the system spec for detail)

- **Monorepo:** `server/` (Python + FastAPI, uv) · `packages/core/` (shared TS: sync engine, generated API types) · `clients/extension|desktop|mobile/` (React / Tauri / React Native) · `docs/`.
- **The wire protocol is the load-bearing wall.** Server and clients share the OpenAPI contract, not code. The server emits `openapi.json`; codegen produces typed TS clients in `packages/core`. The OpenAPI schema snapshot is a server test — contract drift must fail CI and force client-type regeneration.
- **`packages/core` holds all client intelligence** (sync state machine, reconnect/backoff, cursor, outbox, cache). Clients are deliberately thin: UI + platform glue only. Resist adding sync logic to a client.
- **Sync is pull-based with live nudges:** catching up is always `GET /items?cursor=` (ULID cursor); WebSocket and push are wake signals, never the source of truth. One recovery path covers cold start, reconnect, and push-wake. Do not introduce state that depends on never missing a WS event.
- **Single-user MVP, multi-user-ready:** every entity carries `user_id` from day one; registration is a config toggle.
- **Deletions are tombstones** (`deleted_at`), because deletions must sync.
- Push payloads (APNs/FCM) are content-free wake pings — clipboard content never transits Apple/Google.

## Key constraints

- Server language is Python (FastAPI); do not propose rewrites in TS/Rust — the decision and its rationale are recorded in the system spec §2.
- The feed is broadcast-to-all-devices; the device list is a view filter, NOT an address book. No per-device targeting, no cross-user messaging (spec §1 non-goals).
- No E2EE in MVP (trust model: TLS + own server) — do not claim or imply E2EE anywhere.
- Docker image must never run as root; everything persistent lives under a single `/data` root.
- Design tokens: slate neutral chassis, system-adaptive light/dark, user-selectable accent (default amber `#d97706`). Token names defined in the extension spec §7 are the cross-client contract.

## Commands

None yet — the repo has no code. As each phase lands, record its build/test/run commands here (server: uv + pytest; TS packages: vitest; extension E2E: Playwright).
