# CrossClipper — Server E2E Testing Design

**Date:** 2026-07-03
**Status:** Approved design
**Parent spec:** [2026-07-03-cross-clipper-design.md](2026-07-03-cross-clipper-design.md) (§9 testing strategy — this document extends it for the server)

## 1. Goal & principle

Systematic black-box verification of the entire server API surface **against a real running server process**. The existing pytest suite exercises endpoints in-process (TestClient); it stays as the fast inner loop. Everything in this document runs over real sockets against a live `uvicorn` process — that is the defining constraint (approved 2026-07-03): E2E validation happens with a running server, no in-process shortcuts.

Three layers:

| Layer | What | When it runs |
|---|---|---|
| A — Journey suite | Full user journeys over real HTTP + WS | Every PR (CI) |
| B — Schemathesis | Property-based contract fuzzing from `openapi.json` | Every PR (CI), after the contract lands (PR 6) |
| D — Docker smoke | Journey suite against the real container | Release / nightly (phase 2, with Docker packaging) |

(Option C — a Hurl/Bruno docs-collection — was considered and not adopted.)

## 2. Layer A: journey suite

- Location: `server/tests_e2e/` (separate from `server/tests/` so the inner loop stays fast; own pytest marker `e2e`).
- Fixture boots `uvicorn` as a **subprocess** with a temp `/data` dir and scratch env (`CC_SECRET_KEY`, `CC_ALLOW_REGISTRATION` as needed), waits on `/health`, tears down at session end. HTTP via `httpx` against `http://127.0.0.1:<port>`; WS via `websockets` client.
- Journeys (each a test, sharing the live server):
  1. **First-run:** register → second register 403 → login two devices → device list shows both.
  2. **Item lifecycle:** device A posts text + link (targeted and untargeted) → cursor pull from device B sees all, `target_device_id` intact → idempotent replay → oversized body 413 → unsupported kind 422.
  3. **Live events:** device B holds a WS connection → A posts → B receives `item_new`; A deletes → B receives `item_deleted`; cursor re-pull sees the tombstone.
  4. **Revocation:** revoke device B → B's REST gets 401 AND B's WS is closed → A unaffected.
  5. **Recovery drill:** kill the server process mid-session → restart on same port/data → client pulls from cursor → no items lost, no duplicates (absorbs Task 18's scripted drill into a repeatable test).
- The throwaway CLI (Task 17) remains a dev tool; journey tests use raw httpx/websockets so they test the protocol, not the CLI.

## 3. Layer B: Schemathesis

- Runs against the same live-server fixture (base URL mode, not ASGI mode), driven by the committed `openapi.json` (PR 6's snapshot).
- Checks: response schema conformance, status-code declarations, no 5xx on any generated input. Auth via a fixture-created device token passed as an override header.
- Scope guard: `/health` and auth endpoints included; runs with a bounded example budget per endpoint so CI time stays sane (~2–3 min).
- A 5xx found by Schemathesis is a failing check, not noise — the ULID-collision 500 found in Task 6 review is exactly the class this layer automates.

## 4. Layer D: Docker smoke

- Lands with Docker packaging (phase 2 per plan exclusions): builds the image, `docker compose up` with the documented compose file (non-root user, `/data` volume, curl healthcheck), then runs **the same Layer-A journey suite** pointed at the container's URL.
- Verifies what unit/E2E-on-host can't: non-root permissions on `/data`, healthcheck wiring, env plumbing, image completeness.
- Cadence: on release tags + nightly on main, not per-PR.

## 5. CI integration

- Extends `.github/workflows/ci.yml`: existing `server` job (ruff + unit pytest) stays; new `e2e` job runs Layer A (`pytest -m e2e server/tests_e2e`), and Layer B once `openapi.json` exists. D gets its own workflow on tag/schedule in phase 2.

## 6. Build-order placement

- **Layer A** lands as its own PR right after PR 5 (WS hub) — journeys 1, 2, 4 work after PR 4; journey 3 and 5 need the WS hub. One PR, marker + fixture + five journeys + CI job.
- **Layer B** lands as a small PR right after PR 6 (OpenAPI snapshot).
- **Task 18 (plan)** is absorbed: its exit-criterion drill becomes journey 5; the remaining Task 18 scope (CLI demo script) stays as a thin manual script.
- **Layer D** rides with phase 2's Docker packaging.
