# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

CrossClipper: a self-hosted, Pushbullet-like tool for sharing text (later: images/files) across one user's devices — iOS, Android, Windows, and a browser extension — backed by a single self-hosted server.

**Current state: Phase 1 implementation** (server + protocol + core; PRs land per the phase plan). The specs in `docs/superpowers/specs/` are the source of truth and MUST be read before any design or implementation work:

- `2026-07-03-cross-clipper-design.md` — whole-system architecture, data model, wire protocol, notification policy, build order (§10)
- `2026-07-03-extension-client-design.md` — browser extension (Phase 2), incl. validated UI decisions and the design-token contract for all clients
- `2026-07-03-desktop-client-design.md` — Windows/Tauri (Phase 3): hotkey capture model, flyout + full window
- `2026-07-03-mobile-client-design.md` — iOS/Android RN (Phase 4): tabs, swipe gestures, share-sheet target picker
- `2026-07-03-e2e-testing-design.md` — server E2E layers (live-server journeys, Schemathesis, Docker smoke)

Implementation plans live in `docs/superpowers/plans/`. Work proceeds phase-by-phase per §10 of the system spec: each phase gets its own spec → plan → implementation cycle.

## Process conventions (project-specific)

- **Implementation is executed via subagents** (superpowers:subagent-driven-development), keeping the main session free for design work.
- **ALL changes go through PRs** — including docs/specs/README. `main` is branch-protected (PR + green CI required, no direct pushes, applies to admins). Do not commit to main directly.
- Specs and plans are reviewed by Diego before implementation starts; nothing is implemented without an approved plan.
- UI design decisions are made via visual mockups (brainstorming visual companion, sessions in `.superpowers/` — gitignored). Decisions and their rejected alternatives are recorded in the client specs.

## Architecture (read the system spec for detail)

- **Monorepo:** `server/` (Python + FastAPI, uv) · `packages/core/` (shared TS: sync engine, generated API types) · `clients/extension|desktop|mobile/` (React / Tauri / React Native) · `docs/`.
- **The wire protocol is the load-bearing wall.** Server and clients share the OpenAPI contract, not code. The server emits `openapi.json`; codegen produces typed TS clients in `packages/core`. The OpenAPI schema snapshot is a server test — contract drift must fail CI and force client-type regeneration.
- **`packages/core` holds all client intelligence** (sync state machine, reconnect/backoff, cursor, outbox, cache). Clients are deliberately thin: UI + platform glue only. Resist adding sync logic to a client.
- **Sync is pull-based with live nudges:** catching up is always `GET /items?cursor=` (opaque cursor over a modification sequence — `sync_seq`, re-assigned on delete so tombstones are always deliverable; clients never parse cursors); WebSocket and push are wake signals, never the source of truth. One recovery path covers cold start, reconnect, and push-wake. Do not introduce state that depends on never missing a WS event.
- **Single-user MVP, multi-user-ready:** every entity carries `user_id` from day one; registration is a config toggle.
- **Deletions are tombstones** (`deleted_at`), because deletions must sync.
- Push payloads (APNs/FCM) are content-free wake pings — clipboard content never transits Apple/Google.

## Key constraints

- Server language is Python (FastAPI); do not propose rewrites in TS/Rust — the decision and its rationale are recorded in the system spec §2.
- The feed is broadcast-to-all-devices; the device list is a view filter, NOT an address book. Items carry an optional `target_device_id` for NOTIFICATION targeting only — never visibility. No cross-user messaging (spec §1 non-goals, §4 notification policy).
- No passive clipboard watching on ANY platform — capture is always deliberate (desktop hotkey, mobile share sheet, compose paste).
- No E2EE in MVP (trust model: TLS + own server) — do not claim or imply E2EE anywhere.
- Docker image must never run as root; everything persistent lives under a single `/data` root.
- Design tokens: slate neutral chassis, system-adaptive light/dark, user-selectable accent (default amber `#d97706`). Token names defined in the extension spec §7 are the cross-client contract.

## Commands

```bash
# Server (from server/)
uv sync                      # install deps
uv run pytest                # full test suite
uv run pytest tests/test_items_sync.py -k cursor   # single test file / -k filter
uv run ruff check . && uv run ruff format --check . # lint (CI-enforced)
```

CI: `.github/workflows/ci.yml` (ruff + pytest on every PR). TS packages (vitest) and extension E2E (Playwright) commands land with their phases.

## Implementation pipeline (subagent-driven)

- Worktrees live under `.worktrees/` (gitignored). Phase branches are stacked: retarget child PRs to main BEFORE deleting a merged base branch — GitHub closes (not retargets) PRs whose base is deleted.
- SDD progress ledger: `.superpowers/sdd/progress.md` (main checkout; gitignored). Task briefs/reports/review diffs live next to it and in the phase worktree.
- Every task: TDD, independent spec+quality subagent review, fixes re-reviewed. Per-PR checkpoint goes to Diego before push/PR; PRs merge with merge commits after his sign-off.
