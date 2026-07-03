# CrossClipper Phase 2 — Browser Extension + Server Docker Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first real GUI client — an MV3 browser extension (Chrome/Edge/Firefox) with popup feed, compose with notification-target picker, onboarding, settings, background sync worker, notifications and context-menu send — plus the server's Docker packaging (non-root image, compose file, GHCR publish) and E2E Layer D (journey suite against the real container).

**Architecture:** The extension is deliberately thin: the background service worker owns the single `@crossclipper/core` sync engine instance (WS, cursor, outbox) plus an extension-side persisted feed store in `browser.storage.local`; the popup is a pure renderer over runtime messaging. MV3 worker kills are harmless by design — every wake re-instantiates core, which pulls from its persisted cursor. Docker packaging is a multi-stage uv build on Debian slim, defaulting to UID 1000, failing fast on an unwritable `/data`.

**Tech Stack:** React 18, TypeScript 5, Vite + `@crxjs/vite-plugin` v2 (MV3-aware bundling), `webextension-polyfill`, vitest + @testing-library/react (jsdom), Playwright (one happy-path E2E), `@crossclipper/core` (Phase 1) · Docker (python:3.12-slim + uv builder), docker compose, GitHub Actions (GHCR publish + Docker smoke).

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the specs:

- **The extension consumes `@crossclipper/core`, never reimplements sync logic** (system spec §2 principle 2). Sync state machine, reconnect/backoff, cursor, outbox, dedup all come from core. Extension code is UI + platform glue (storage adapters, WS adapter, notifications, context menu) only.
- Sync source of truth is always `GET /items?cursor=` (core's `SyncEngine` does this); WS is a nudge channel. Never add extension state that depends on not missing a WS event.
- **Notification policy** (system spec §4): targeted item → only the target device notifies, always, regardless of toggle. Untargeted → silent everywhere by default; per-device local **"notify me on new items"** toggle (default **off**). Targeting controls alerting, never visibility. The device rail is a view filter, NOT an address book.
- No passive clipboard watching in the browser — capture is deliberate (compose paste, context menu). No E2EE claims anywhere.
- Design tokens (extension spec §7): slate neutrals `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`; accent `--accent`, `--accent-fg`, `--accent-soft` (default amber `#d97706`); semantic `--success`, `--danger`; radii + spacing scale. Token **names** are the cross-client contract. They live in `clients/extension/src/theme/` — extraction to `packages/ui` is deferred until desktop needs it (YAGNI).
- Popup ≈ **380×540 px**. Feed cards: origin + relative time header, ~3-line clamp, kind-aware always-visible actions (`text`: Copy/Delete; `link`: Copy/Open/Delete; unknown kind → "Unsupported item — update client" fallback). Compose: Enter sends, Shift+Enter newline, target chips default "Silent".
- Onboarding: 3 steps (Server → Sign in → Appearance, step 3 skippable). Warn loudly on plain `http://` for non-localhost/non-private addresses. Settings: tabs Devices / Look / General; stale-device "Revoke?" nudge at **14+ days**.
- Auth token in `browser.storage.local` (never `.sync`). 401 → one redirect to onboarding step 2 with server pre-filled — never a retry loop.
- **Docker** (system spec §7): image never runs as root, defaults to **UID 1000**; includes `curl` for the healthcheck; everything persistent under a single **`/data`** root (`/data/db.sqlite`, `/data/blobs/`); **fail fast** if `/data` is unwritable at boot with the exact chown hint; `CC_SECRET_KEY` is the only required setting; healthcheck curls `/health` (interval 30s, timeout 5s, retries 3, start_period 10s).
- E2E Layer D (e2e spec §4): build the image, `docker compose up` with the documented compose file, run the Layer-A journey suite against the container's URL; cadence = release tags + nightly, not per-PR.
- TDD (superpowers:test-driven-development): failing test first, watch it fail, then implement. Conventional Commits; atomic commits; **PRs ≤ ~600 LOC soft cap** (source and tests counted separately; generated files and lockfiles exempt); merge commits only.
- Server commands run from `server/` with `uv run …`; JS commands from repo root with `npm run <script> --workspace @crossclipper/extension`.

## Workflow note (Diego's global workflow)

Execute in a git worktree off `main`. Commits are made locally per task as written below. **At each PR checkpoint: STOP, present the diff for Diego's review, and only push + open the PR after sign-off.** Merge with merge commits; monitor CI after opening each PR. PRs are sequential (each branches from the merged result of the previous one).

## Phase 1 dependency gate

Phase 1 may not be fully merged when execution starts. Each PR below declares what it needs. Verified state at plan time: server PRs 1–5 and E2E Layer A (`server/tests_e2e/` with fixtures `server`, `first_run_server`, `restart_server`, and `crossclipper.asgi:app`) are on `main`; `packages/core`, the npm workspace root, and the CLI (Phase 1 PRs 6–10) are **not yet merged**.

| Phase 2 PR | Needs from Phase 1 |
|---|---|
| PR 1 (Docker image) | Server PRs 1–5 (merged ✓) |
| PR 2 (GHCR + Layer D) | E2E Layer A (merged ✓) + this plan's PR 1 |
| PR 3 (extension scaffold + tokens) | Phase 1 PR 6 (npm workspace root). If PR 6 is not merged yet, STOP and wait — do not create a competing root `package.json`. |
| PR 4 (popup UI, fixtures) | Phase 1 PR 6 (`@crossclipper/core` package with generated types — type-only imports) |
| PR 5 (protocol prerequisites) | Phase 1 PRs 6–9 fully merged (touches core source) |
| PRs 6–11 | Phase 1 PRs 6–9 fully merged (extension consumes `ApiClient`, `SyncEngine`, `Outbox`, `SyncStorage`) |

If core is blocked, execute PRs 1–4 first; they are core-free (PRs 3–4 need only the workspace root and generated types).

## Spec ambiguities resolved by this plan

Decisions made where the specs were silent or in tension (flag to Diego at review; each is cheap to change):

1. **`GET /health` gains server identity fields.** Onboarding step 1 needs "✓ CrossClipper v1.2 found", "not a CrossClipper server" detection, and first-run detection ("server reports no user exists"). Phase 1's `/health` returns only `{"status": "ok"}`. Resolution: extend it to `{status, app: "crossclipper", version, registration_open}` (PR 5). `registration_open` is exposed unauthenticated — acceptable for a personal server and required for the spec'd onboarding UX.
2. **Presence is a true, minimal protocol** *(amended at Diego's plan review — replaces the earlier "derived from `last_seen_at`" resolution)*. Extension spec §3 says "presence dot from WS presence"; Phase 1 built no presence protocol, but the Hub already knows exactly which devices hold open sockets. Resolution: `GET /devices` gains `online: bool` (device online ⇔ ≥1 open WS socket in the Hub registry), and the server broadcasts the **existing** `device_changed` event whenever a device transitions offline→online (first socket opens) or online→offline (last socket closes). Clients already re-fetch the device list on `device_changed` (Task 13's handler), so presence rides the established nudge→pull path: no new event types, no client-side freshness windows, and a missed event self-corrects on the next devices fetch — pull stays the source of truth. Silently-dropped connections are reaped by uvicorn's built-in WS ping keepalive (~40 s), which triggers the Hub's cleanup and thus the offline broadcast. Server work is Task 10b (PR 5); system spec §4 amended to match.
3. **Rail filtering is client-side over the synced cache**, not `GET /items?origin=`. The cache is the render source (extension spec §6); re-fetching per rail click would bypass it and break offline. The REST `origin=` param remains for cache-less clients.
4. **Core `Outbox` lacks notification-target support.** The Phase 1 amendment threaded `target_device_id` through `createItem`, but `Outbox.send(kind, body)` has no target parameter. Resolution: PR 5 extends core — `Outbox.send(kind, body, targetDeviceId?)`, `OutboxEntry.target_device_id?` (backward-compatible persisted JSON).
5. **Host permissions instead of server-side CORS.** The server URL is user-typed, and `CC_CORS_ORIGINS` defaults to none — a CORS-based flow would dead-end onboarding. Resolution: `optional_host_permissions: ["http://*/*", "https://*/*"]`, requested for exactly the entered origin on onboarding "Next" (a user gesture); `http://localhost/*` + `http://127.0.0.1/*` are pre-granted in `host_permissions` (also makes the Playwright E2E prompt-free). Server CORS config stays for future web clients.
6. **Compose kind detection:** a trimmed body that is a single `http(s)://` URL is sent as `kind: "link"`, else `"text"`.
7. **Target picker excludes the current device** (notifying yourself is a no-op), and resets to "Silent" after each send (silent-by-default policy).
8. **Notification dedup across worker restarts** via a persisted ULID watermark (`cc.alert.watermark`): only items with `id >` watermark can alert/badge, so re-pulls never re-notify. Targeted items that arrived while the browser was closed still notify exactly once.
9. **Item persistence for instant popup render:** core's `ItemCache` is in-memory and the cursor-based pull only returns *new* items after a worker restart. The extension persists rendered items itself (`FeedStore` over `browser.storage.local`, capped at 1000 newest). This is persistence glue, not sync logic — dedup/ordering of live data stays in core.
10. **Bundler: `@crxjs/vite-plugin` v2** (spec allows "@crxjs or equivalent"). Firefox support = `webextension-polyfill` everywhere + a post-build manifest transform (`background.scripts`, gecko id); Firefox gets manual smoke only this phase (Playwright E2E runs Chromium).
11. **Layer D vs process-control journeys:** `first_run_server` and `restart_server` journeys spawn/kill local uvicorn processes and cannot run against a container. In Layer D they skip; container-level equivalents (fresh-volume registration, `docker compose restart` persistence, non-root UID check, healthcheck) run as workflow steps.
12. **GHCR image name:** `ghcr.io/diegoheer/crossclipper-server` (GHCR requires lowercase owner). Publish on `v*` tags (`:latest` + `:<version>`); smoke runs on tags + nightly cron + manual dispatch.
13. **Structured JSON logs** (system spec §7 observability) are consciously deferred — not part of the Phase 2 task scope; uvicorn's default logs stand until a dedicated observability change.
14. **Theme "auto" resolves in JS** (matchMedia → `data-theme` attribute) rather than duplicated `@media` CSS blocks; appearance is mirrored to `localStorage` so the popup can apply it synchronously before first paint (`browser.storage.local` is async-only).
15. **`ItemsPage` responses only carry items** — device names come from the cached device list; unknown origin devices render as "Unknown device".

## PR sequence (11 PRs)

| PR | Branch | Title (conventional) | Tasks | Est. LOC (src/test) |
|----|--------|----------------------|-------|---------------------|
| 1 | `feat/docker-packaging` | `feat(server): docker image, compose file and fail-fast /data check` | 1–2 | ~130 (+Dockerfile/compose ~90) / ~60 |
| 2 | `ci/docker-publish-smoke` | `ci: GHCR publish workflow and docker smoke (E2E layer D)` | 3–4 | ~30 py + ~130 yaml / — |
| 3 | `feat/extension-scaffold` | `feat(extension): MV3 scaffold, design tokens and theme engine` | 5–6 | ~280 / ~140 |
| 4 | `feat/extension-popup-ui` | `feat(extension): popup UI components with fixture data` | 7–9 | ~520 / ~380 |
| 5 | `feat/protocol-phase2-prereqs` | `feat(protocol): health server info, live presence and targeted outbox sends` | 10, 10b, 11 | ~150 py + ~80 ts / ~240 |
| 6 | `feat/extension-worker` | `feat(extension): background worker owning the core sync engine` | 12–13 | ~430 / ~360 |
| 7 | `feat/extension-popup-live` | `feat(extension): wire popup to the live worker` | 14–15 | ~350 / ~280 |
| 8 | `feat/extension-onboarding` | `feat(extension): three-step onboarding and re-auth flow` | 16–17 | ~400 / ~280 |
| 9 | `feat/extension-alerts` | `feat(extension): notifications, unread badge and context-menu send` | 18–19 | ~240 / ~220 |
| 10 | `feat/extension-settings` | `feat(extension): settings page (devices, look, general)` | 20–21 | ~350 / ~250 |
| 11 | `test/extension-e2e` | `test(extension): playwright happy-path E2E and firefox build variant` | 22–23 | ~90 / ~280 (+config) |

## File structure (end state; Phase 1 files not repeated)

```
cross-clipper/
├── Dockerfile                            # Task 2 (repo root — build context needs server/)
├── .dockerignore                         # Task 2
├── docker-compose.yml                    # Task 2 (the documented deployment)
├── docker-compose.ci.yml                 # Task 4 (CI override: local image tag)
├── .github/workflows/
│   ├── ci.yml                            # Modified: extension job (Task 5), e2e job (Task 22)
│   └── docker.yml                        # Task 4: smoke (Layer D) + GHCR publish
├── server/
│   ├── src/crossclipper/
│   │   ├── main.py                       # Modified Task 1 (fail-fast /data), Task 10 (health wiring)
│   │   └── health.py                     # Modified Task 10 (HealthOut: app/version/registration_open)
│   ├── tests/test_health.py              # Modified Task 10
│   ├── tests/test_data_dir.py            # Task 1
│   └── tests_e2e/conftest.py             # Modified Task 3 (CC_E2E_BASE_URL external mode)
├── packages/core/src/
│   ├── api/client.ts                     # Modified Task 11 (health())
│   ├── types.ts                          # Modified Task 11 (HealthOut alias)
│   └── outbox.ts                         # Modified Task 11 (targetDeviceId)
├── package.json                          # Modified Task 5 (workspaces + clients/extension)
└── clients/extension/
    ├── package.json                      # Task 5
    ├── tsconfig.json                     # Task 5
    ├── vite.config.ts                    # Task 5 (crxjs)
    ├── vitest.config.ts                  # Task 5 (jsdom, polyfill alias)
    ├── manifest.json                     # Task 5 (MV3)
    ├── scripts/make-icons.mjs            # Task 5 (placeholder PNG icons, no deps)
    ├── scripts/build-firefox.mjs         # Task 23 (manifest transform)
    ├── public/icons/icon-{16,48,128}.png # generated by make-icons.mjs (exempt)
    ├── src/
    │   ├── theme/tokens.css              # Task 6 — THE design-token contract
    │   ├── theme/theme.ts                # Task 6 — apply/resolve/accent derivation
    │   ├── shared/model.ts               # Task 7 — DeviceView, platformIcon, parseUtc
    │   ├── shared/storage.ts             # Task 12 — ExtensionStorage (SyncStorage impl)
    │   ├── shared/settings.ts            # Task 12 — auth/prefs/appearance persistence
    │   ├── shared/messages.ts            # Task 12 — popup↔worker contract + guards
    │   ├── popup/
    │   │   ├── index.html                # Task 5
    │   │   ├── main.tsx                  # Task 5 (initTheme before render)
    │   │   ├── App.tsx                   # Task 9 (shell) → rewired Task 15 → routes Task 17/20
    │   │   ├── popup.css                 # Task 9 (layout, cards, rail, chips)
    │   │   ├── format.tsx                # Task 7 — relativeTime, detectKind, linkify
    │   │   ├── fixtures.ts               # Task 9 — sample items/devices (dev/static tests)
    │   │   ├── useWorker.ts              # Task 14 — port + reducer + WorkerApi
    │   │   ├── components/
    │   │   │   ├── FeedCard.tsx          # Task 7
    │   │   │   ├── DeviceRail.tsx        # Task 8
    │   │   │   ├── TargetPicker.tsx      # Task 8
    │   │   │   ├── Compose.tsx           # Task 8
    │   │   │   ├── Feed.tsx              # Task 15 (list + new-items pill + empty state)
    │   │   │   ├── Banner.tsx            # Task 9 (reconnecting / version notice)
    │   │   │   └── ThemeControls.tsx     # Task 17 (theme toggle + swatches + preview)
    │   │   ├── onboarding/
    │   │   │   ├── probe.ts              # Task 16 — normalize/insecure/semver/probeServer
    │   │   │   ├── Onboarding.tsx        # Task 17 — stepper
    │   │   │   ├── ServerStep.tsx        # Task 16
    │   │   │   ├── SignInStep.tsx        # Task 17
    │   │   │   └── AppearanceStep.tsx    # Task 17
    │   │   └── settings/
    │   │       ├── Settings.tsx          # Task 20 — tabs + back arrow + status card
    │   │       ├── DevicesTab.tsx        # Task 20
    │   │       ├── LookTab.tsx           # Task 21
    │   │       └── GeneralTab.tsx        # Task 21
    │   └── background/
    │       ├── index.ts                  # Task 13 glue → alerts/menus wiring Task 18/19
    │       ├── controller.ts             # Task 13 — BackgroundController
    │       ├── feedStore.ts              # Task 12 — persisted item list
    │       ├── socket.ts                 # Task 13 — browserSocketFactory (WsLike)
    │       ├── alerts.ts                 # Task 18 — AlertManager (policy + badge)
    │       └── menus.ts                  # Task 19 — context-menu send
    ├── tests/
    │   ├── setup.ts                      # Task 5 (jest-dom, matchMedia stub)
    │   ├── polyfillMock.ts               # Task 5 (webextension-polyfill alias target)
    │   ├── fakeBrowser.ts                # Task 12 (storage/runtime/alarms/notifications fakes)
    │   ├── theme.test.ts                 # Task 6
    │   ├── format.test.tsx               # Task 7
    │   ├── feedCard.test.tsx             # Task 7
    │   ├── railComposeTarget.test.tsx    # Task 8
    │   ├── appStatic.test.tsx            # Task 9
    │   ├── messages.test.ts              # Task 12 (contract tests)
    │   ├── feedStore.test.ts             # Task 12
    │   ├── settingsStore.test.ts         # Task 12
    │   ├── controller.test.ts            # Task 13
    │   ├── useWorker.test.tsx            # Task 14
    │   ├── appLive.test.tsx              # Task 15
    │   ├── probe.test.ts                 # Task 16
    │   ├── onboarding.test.tsx           # Task 17
    │   ├── alerts.test.ts                # Task 18
    │   ├── menus.test.ts                 # Task 19
    │   └── settingsPage.test.tsx         # Tasks 20–21
    └── e2e/
        ├── playwright.config.ts          # Task 22
        ├── server.ts                     # Task 22 (uvicorn subprocess helper)
        ├── fixtures.ts                   # Task 22 (persistent context + extension id)
        └── tests/happy-path.spec.ts      # Task 22
```

---

# PR 1 — Server Docker packaging

**Needs:** Phase 1 server PRs merged (they are). No core dependency.

## Task 1: Fail-fast on unwritable `/data`

The container never runs as root, so a host-owned `./data` directory is the #1 first-run failure. Per system spec §7: no chown-on-startup magic — exit immediately with an actionable message.

**Files:**
- Create: `server/tests/test_data_dir.py`
- Modify: `server/src/crossclipper/main.py` (top of `create_app`)

**Interfaces:**
- Consumes: `Settings` (Phase 1), `create_app`.
- Produces: `ensure_writable_data_dir(settings: Settings) -> None` in `crossclipper.main` — raises `SystemExit` with the chown hint when `/data` can't be created or written; called by `create_app` before the engine is built.

- [ ] **Step 1: Write the failing test**

`server/tests/test_data_dir.py`:

```python
"""Boot-time /data writability check (system spec §7: fail fast, no chown magic)."""

import os
from pathlib import Path

import pytest

from crossclipper.config import Settings
from crossclipper.main import create_app


@pytest.mark.skipif(os.getuid() == 0, reason="root bypasses permission checks")
def test_unwritable_data_dir_exits_with_chown_hint(tmp_path: Path) -> None:
    locked = tmp_path / "data"
    locked.mkdir()
    locked.chmod(0o500)  # r-x: cannot create files inside
    try:
        with pytest.raises(SystemExit) as excinfo:
            create_app(Settings(secret_key="t", data_dir=locked))
        msg = str(excinfo.value)
        assert "is not writable by UID" in msg
        assert "chown -R 1000:1000 ./data" in msg
        assert "user:" in msg  # compose hint
    finally:
        locked.chmod(0o700)  # let pytest clean up tmp_path


@pytest.mark.skipif(os.getuid() == 0, reason="root bypasses permission checks")
def test_uncreatable_data_dir_exits_with_chown_hint(tmp_path: Path) -> None:
    parent = tmp_path / "parent"
    parent.mkdir()
    parent.chmod(0o500)
    try:
        with pytest.raises(SystemExit, match="is not writable by UID"):
            create_app(Settings(secret_key="t", data_dir=parent / "data"))
    finally:
        parent.chmod(0o700)


def test_writable_data_dir_boots_normally(tmp_path: Path) -> None:
    app = create_app(Settings(secret_key="t", data_dir=tmp_path / "data"))
    assert app.state.settings.data_dir.exists()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && uv run pytest tests/test_data_dir.py -v`
Expected: FAIL — first two tests raise `PermissionError` (not `SystemExit`) because `create_app` calls `mkdir` unguarded.

- [ ] **Step 3: Implement the check**

In `server/src/crossclipper/main.py`, add `import os` to the imports, then add above `create_app`:

```python
def ensure_writable_data_dir(settings: Settings) -> None:
    """Fail fast if the data root is unusable (system spec §7).

    The image runs as UID 1000, never root, and does no chown-on-startup
    magic — so a host-owned ./data must be fixed by the operator.
    """
    try:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.blobs_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.data_dir / ".boot-probe"
        probe.write_text("ok")
        probe.unlink()
    except OSError as exc:
        raise SystemExit(
            f"{settings.data_dir} is not writable by UID {os.getuid()} — "
            f"run: chown -R 1000:1000 ./data or set user: in compose ({exc})"
        ) from exc
```

Inside `create_app`, replace the two mkdir lines:

```python
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.blobs_dir.mkdir(parents=True, exist_ok=True)
```

with:

```python
    ensure_writable_data_dir(settings)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/test_data_dir.py -v && uv run pytest`
Expected: new tests PASS; full suite still green.

- [ ] **Step 5: Lint and commit**

```bash
cd server && uv run ruff check . && uv run ruff format .
git add server/src/crossclipper/main.py server/tests/test_data_dir.py
git commit -m "feat(server): fail fast with chown hint when /data is not writable"
```

## Task 2: Dockerfile, compose file and self-hosting docs

**Files:**
- Create: `Dockerfile` (repo root — the build context must include `server/`)
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Modify: `README.md` (add a "Self-hosting" section)

**Interfaces:**
- Consumes: `crossclipper.asgi:app` (Phase 1 E2E PR's ASGI entrypoint), `server/pyproject.toml` + `server/uv.lock`.
- Produces: image `crossclipper-server` — listens on 8080, `USER 1000:1000`, `CC_DATA_DIR=/data`, curl-based `HEALTHCHECK`; `docker-compose.yml` matching system spec §7 (used verbatim by Layer D in Task 4).

There is no unit-test harness for a Dockerfile; verification is the scripted build/run checks in Steps 3–4 (Layer D automates them in PR 2).

- [ ] **Step 1: Write the Dockerfile and .dockerignore**

`Dockerfile`:

```dockerfile
# ---- build: resolve deps with uv into a self-contained venv -----------------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
# Layer-cache deps separately from source.
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY server/src ./src
RUN uv sync --frozen --no-dev

# ---- runtime: slim image, never root (system spec §7) -----------------------
FROM python:3.12-slim-bookworm
# curl: meaningful healthcheck + in-container debugging (spec §7).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=1000:1000 /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    CC_DATA_DIR=/data
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD curl -fsS http://localhost:8080/health || exit 1
CMD ["uvicorn", "crossclipper.asgi:app", "--host", "0.0.0.0", "--port", "8080"]
```

`.dockerignore`:

```
*
!server/pyproject.toml
!server/uv.lock
!server/src
```

- [ ] **Step 2: Write the compose file**

`docker-compose.yml` (this is the documented deployment from system spec §7 — keep it minimal):

```yaml
# CrossClipper — the entire deployment.
#   1. mkdir data          (or: chown -R 1000:1000 ./data if it exists)
#   2. set CC_SECRET_KEY   (any long random string; the only required setting)
#   3. docker compose up -d
# TLS termination is your reverse proxy's job (Caddy/Traefik/nginx) — TLS in
# front is non-negotiable for non-LAN use.
services:
  crossclipper:
    image: ${CROSSCLIPPER_IMAGE:-ghcr.io/diegoheer/crossclipper-server:latest}
    user: "1000:1000" # match your host user (id -u:id -g) so ./data stays yours
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data # SQLite DB + blobs; backup = copy this folder
    environment:
      CC_SECRET_KEY: ${CC_SECRET_KEY:?set CC_SECRET_KEY in the environment or an .env file}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

(`CROSSCLIPPER_IMAGE` defaults to the published image; CI overrides it to the locally-built tag — one compose file, no drift.)

- [ ] **Step 3: Build and verify the happy path**

```bash
docker build -t crossclipper-server:dev .
mkdir -p /tmp/cc-docker-data && chmod 777 /tmp/cc-docker-data
docker run -d --name cc-smoke -p 18080:8080 -v /tmp/cc-docker-data:/data \
  -e CC_SECRET_KEY=dev-secret crossclipper-server:dev
sleep 3 && curl -fsS http://127.0.0.1:18080/health
docker inspect --format '{{.State.Health.Status}}' cc-smoke   # after ~35s: healthy
docker exec cc-smoke id -u                                     # → 1000
ls /tmp/cc-docker-data                                         # → blobs  db.sqlite
docker rm -f cc-smoke
```

Expected: `{"status":"ok"}`, UID `1000`, DB + blobs under the single data root.

- [ ] **Step 4: Verify the fail-fast path**

```bash
mkdir -p /tmp/cc-locked && sudo chown root:root /tmp/cc-locked && sudo chmod 755 /tmp/cc-locked
docker run --rm -v /tmp/cc-locked:/data -e CC_SECRET_KEY=x crossclipper-server:dev; echo "exit=$?"
```

Expected: container exits non-zero and prints `"/data is not writable by UID 1000 — run: chown -R 1000:1000 ./data or set user: in compose"`.

- [ ] **Step 5: Verify compose end-to-end**

```bash
mkdir -p ./data
CC_SECRET_KEY=dev-secret CROSSCLIPPER_IMAGE=crossclipper-server:dev docker compose up -d --wait
curl -fsS http://127.0.0.1:8080/health
docker compose down && rm -rf ./data
```

Expected: `--wait` returns once healthy; health returns ok.

- [ ] **Step 6: Add the Self-hosting section to README.md**

Append to `README.md` (adjust position to fit the existing structure — after the project intro):

```markdown
## Self-hosting

The entire deployment is one container and one folder:

```bash
mkdir crossclipper && cd crossclipper
curl -fsSLO https://raw.githubusercontent.com/DiegoHeer/cross-clipper/main/docker-compose.yml
mkdir data                       # owned by you; the container runs as UID 1000
echo "CC_SECRET_KEY=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Backup = copy `./data`. Put TLS in front (Caddy/Traefik/nginx) — the server
speaks plain HTTP and TLS termination is the deployment's job.

| Env var | Default | Meaning |
|---|---|---|
| `CC_SECRET_KEY` | — (required) | Secret key; any long random string |
| `CC_DATA_DIR` | `/data` (image) | Root for the SQLite DB and blobs |
| `CC_ALLOW_REGISTRATION` | `false` | Re-open registration after first user |
| `CC_ITEM_MAX_BYTES` | `262144` | Item body size cap (bytes) |
| `CC_TOMBSTONE_RETENTION_DAYS` | `30` | Days before deleted items are pruned |
| `CC_TOKEN_TTL_DAYS` | `365` | Device token lifetime |
| `CC_CORS_ORIGINS` | (none) | Comma-separated allowed origins |
| `CC_MIN_CLIENT_VERSION` | `0.0.0` | Reject older clients (426) |

If the container exits with `/data is not writable by UID 1000`, run
`chown -R 1000:1000 ./data` or set `user: "$(id -u):$(id -g)"` in the compose file.
```

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml README.md
git commit -m "feat(server): docker image and compose deployment (non-root, /data, healthcheck)"
```

### PR 1 checkpoint

- [ ] `cd server && uv run pytest && uv run ruff check .` green; Steps 3–5 verifications performed.
- [ ] **STOP — Diego review**, then push + PR `feat(server): docker image, compose file and fail-fast /data check`.

---

# PR 2 — GHCR publish + E2E Layer D

**Needs:** PR 1 merged; E2E Layer A on main (it is).

## Task 3: External-server mode for the journey suite

Layer D reuses the Layer-A journeys against the container. Journeys that spawn/kill their own uvicorn (`first_run_server`, `restart_server`) skip in external mode (ambiguity 11).

**Files:**
- Modify: `server/tests_e2e/conftest.py`

**Interfaces:**
- Consumes: existing fixtures `server` (session `ServerInfo`), `first_run_server`, `restart_server`; `ServerInfo` dataclass.
- Produces: env contract `CC_E2E_BASE_URL=<url>` — when set, the session `server` fixture targets that URL instead of booting a subprocess (`ServerInfo.proc` becomes `subprocess.Popen | None`), and process-control fixtures `pytest.skip`.

- [ ] **Step 1: Write the failing test (fixture behavior probe)**

Append to `server/tests_e2e/conftest.py`'s companion — add a tiny test at the bottom of `server/tests_e2e/test_journeys.py`:

```python
@pytest.mark.e2e
def test_external_mode_contract(server: ServerInfo) -> None:
    """In CC_E2E_BASE_URL mode the suite must target the external server."""
    external = os.environ.get("CC_E2E_BASE_URL")
    if external:
        assert server.base_url == external.rstrip("/")
        assert server.proc is None
    else:
        assert server.proc is not None
```

(Add `import os` to the test module's imports if missing.)

- [ ] **Step 2: Run to verify it fails in external mode**

Run (from `server/`, with any Phase-1 dev server running on 8080 — or expect the healthy-wait to fail fast):
`CC_E2E_BASE_URL=http://127.0.0.1:9 uv run pytest -m e2e tests_e2e/test_journeys.py::test_external_mode_contract -v`
Expected: FAIL — the fixture still boots its own subprocess and `server.base_url` is a random local port, not the env value.

- [ ] **Step 3: Implement external mode in conftest.py**

In `server/tests_e2e/conftest.py`:

1. Change the `ServerInfo` dataclass field `proc: subprocess.Popen` → `proc: subprocess.Popen | None`.
2. Add near the top (after imports):

```python
_EXTERNAL_BASE_URL = os.environ.get("CC_E2E_BASE_URL")
```

3. At the top of the session-scoped `server` fixture body, before the subprocess boot:

```python
    if _EXTERNAL_BASE_URL:
        base_url = _EXTERNAL_BASE_URL.rstrip("/")
        _wait_healthy(base_url)
        yield ServerInfo(base_url=base_url, port=0, data_dir=Path("/unused"), proc=None)
        return
```

4. At the top of `first_run_server` and `restart_server` fixture bodies:

```python
    if _EXTERNAL_BASE_URL:
        pytest.skip("requires local process control; container-level checks cover this in Layer D")
```

- [ ] **Step 4: Run both modes to verify**

```bash
cd server
uv run pytest -m e2e tests_e2e/ -v                       # local mode: all journeys pass
docker build -t crossclipper-server:d -f ../Dockerfile .. \
  && mkdir -p /tmp/cc-d && chmod 777 /tmp/cc-d \
  && docker run -d --name cc-d -p 18081:8080 -v /tmp/cc-d:/data -e CC_SECRET_KEY=d crossclipper-server:d \
  && sleep 3 \
  && CC_E2E_BASE_URL=http://127.0.0.1:18081 uv run pytest -m e2e tests_e2e/ -v
docker rm -f cc-d
```

Expected: local mode fully green; external mode green with `first_run` / `kill_recovery` journeys SKIPPED and the rest PASSED against the container.

- [ ] **Step 5: Lint and commit**

```bash
cd server && uv run ruff check . && uv run ruff format .
git add server/tests_e2e
git commit -m "test(e2e): support external server via CC_E2E_BASE_URL for docker smoke"
```

## Task 4: Docker workflow — Layer D smoke + GHCR publish

**Files:**
- Create: `.github/workflows/docker.yml`
- Create: `docker-compose.ci.yml`

**Interfaces:**
- Consumes: `docker-compose.yml` (`CROSSCLIPPER_IMAGE` env hook), `CC_E2E_BASE_URL` mode (Task 3).
- Produces: workflow `docker.yml` — job `smoke` (tags + nightly + dispatch) and job `publish` (tags only, needs smoke); images `ghcr.io/diegoheer/crossclipper-server:latest` and `:<version>`.

- [ ] **Step 1: Write the CI compose override**

`docker-compose.ci.yml`:

```yaml
# CI override: run the documented compose file against the locally-built image
# with a throwaway secret. Usage:
#   docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --wait
services:
  crossclipper:
    image: crossclipper-server:ci
    environment:
      CC_SECRET_KEY: ci-smoke-secret
```

- [ ] **Step 2: Write the workflow**

`.github/workflows/docker.yml`:

```yaml
name: Docker

on:
  push:
    tags: ["v*"]
  schedule:
    - cron: "17 3 * * *" # nightly on main
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  smoke:
    name: Docker smoke (E2E Layer D)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t crossclipper-server:ci .

      - name: Prepare data dir (owned by UID 1000)
        run: mkdir -p data && sudo chown 1000:1000 data

      - name: Compose up (documented compose file + CI override)
        run: docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --wait --wait-timeout 60

      - name: Container-level checks (non-root, /data layout)
        run: |
          test "$(docker compose exec -T crossclipper id -u)" = "1000"
          curl -fsS http://127.0.0.1:8080/health
          sudo test -f data/db.sqlite

      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true

      - name: Journey suite against the container (Layer D)
        working-directory: server
        env:
          CC_E2E_BASE_URL: http://127.0.0.1:8080
        run: |
          uv sync
          uv run pytest -m e2e tests_e2e/ -v

      - name: Restart persistence check (container recovery drill)
        run: |
          docker compose -f docker-compose.yml -f docker-compose.ci.yml restart crossclipper
          docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --wait --wait-timeout 60
          curl -fsS http://127.0.0.1:8080/health

      - name: Fail-fast check (root-owned /data must exit with hint)
        run: |
          sudo mkdir -p /tmp/cc-locked && sudo chmod 755 /tmp/cc-locked
          set +e
          out=$(docker run --rm -v /tmp/cc-locked:/data -e CC_SECRET_KEY=x crossclipper-server:ci 2>&1)
          code=$?
          set -e
          echo "$out"
          test $code -ne 0
          echo "$out" | grep -q "is not writable by UID 1000"

      - name: Logs on failure
        if: failure()
        run: docker compose -f docker-compose.yml -f docker-compose.ci.yml logs

      - name: Compose down
        if: always()
        run: docker compose -f docker-compose.yml -f docker-compose.ci.yml down

  publish:
    name: Publish to GHCR
    runs-on: ubuntu-latest
    needs: smoke
    if: startsWith(github.ref, 'refs/tags/v')
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          IMAGE=ghcr.io/diegoheer/crossclipper-server
          docker build -t "$IMAGE:$VERSION" -t "$IMAGE:latest" .
          docker push "$IMAGE:$VERSION"
          docker push "$IMAGE:latest"
```

- [ ] **Step 3: Verify locally what CI will run**

```bash
docker build -t crossclipper-server:ci .
mkdir -p data && sudo chown 1000:1000 data
docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --wait
(cd server && CC_E2E_BASE_URL=http://127.0.0.1:8080 uv run pytest -m e2e tests_e2e/ -v)
docker compose -f docker-compose.yml -f docker-compose.ci.yml down && sudo rm -rf data
```

Expected: journeys green (process-control journeys skipped), compose healthy.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/docker.yml docker-compose.ci.yml
git commit -m "ci: docker smoke workflow (E2E layer D) and GHCR publish on tags"
```

### PR 2 checkpoint

- [ ] Local Layer-D run green; `workflow_dispatch` noted as the post-merge verification path (run it once after merge and confirm the smoke job passes).
- [ ] **STOP — Diego review**, then push + PR `ci: GHCR publish workflow and docker smoke (E2E layer D)`.

---
# PR 3 — Extension scaffold + design tokens

**Needs:** Phase 1 PR 6 merged (npm workspace root exists). Core logic NOT needed.

## Task 5: Extension workspace scaffold (Vite + crxjs + vitest + CI)

**Files:**
- Modify: `package.json` (repo root — add `clients/extension` to `workspaces`)
- Create: `clients/extension/package.json`, `clients/extension/tsconfig.json`, `clients/extension/vite.config.ts`, `clients/extension/vitest.config.ts`, `clients/extension/manifest.json`
- Create: `clients/extension/scripts/make-icons.mjs` (+ run it → `public/icons/*.png`)
- Create: `clients/extension/src/popup/index.html`, `clients/extension/src/popup/main.tsx`, `clients/extension/src/popup/App.tsx` (placeholder), `clients/extension/src/background/index.ts` (placeholder)
- Create: `clients/extension/tests/setup.ts`, `clients/extension/tests/polyfillMock.ts`, `clients/extension/tests/scaffold.test.tsx`
- Modify: `.github/workflows/ci.yml` (extension job)
- Modify: `.gitignore` (add `clients/extension/dist/`, `clients/extension/dist-firefox/`, `clients/extension/e2e-results/`)

**Interfaces:**
- Consumes: npm workspace root (Phase 1 Task 11).
- Produces: workspace `@crossclipper/extension` with scripts `dev`, `build`, `test`, `typecheck`, `icons`; MV3 `manifest.json` (popup at `src/popup/index.html`, worker at `src/background/index.ts`, permissions `storage alarms notifications contextMenus clipboardWrite`, pre-granted localhost host permissions, `optional_host_permissions` for everything else); vitest alias `webextension-polyfill → tests/polyfillMock.ts` and a mutable `setFakeBrowser(fake)` hook every later test uses.

- [ ] **Step 1: Write the failing test**

`clients/extension/tests/scaffold.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/popup/App";

describe("scaffold", () => {
  it("renders the popup header", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create the workspace**

Root `package.json`: add `"clients/extension"` to the existing `workspaces` array (keep `packages/core` and any existing entries).

`clients/extension/package.json`:

```json
{
  "name": "@crossclipper/extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "icons": "node scripts/make-icons.mjs"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "webextension-polyfill": "^0.12.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/webextension-polyfill": "^0.12.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

(If installed versions drift, accept what `npm install` resolves — pin ranges, not exact builds. `@crossclipper/core` is deliberately NOT a dependency yet; it is added in Task 7.)

`clients/extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts", "manifest.json"]
}
```

`clients/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "CrossClipper",
  "version": "0.1.0",
  "description": "Share text and links across your devices via your own CrossClipper server.",
  "action": { "default_popup": "src/popup/index.html", "default_title": "CrossClipper" },
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "permissions": ["storage", "alarms", "notifications", "contextMenus", "clipboardWrite"],
  "host_permissions": ["http://localhost/*", "http://127.0.0.1/*"],
  "optional_host_permissions": ["http://*/*", "https://*/*"]
}
```

`clients/extension/vite.config.ts`:

```ts
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [react(), crx({ manifest: manifest as never })],
});
```

`clients/extension/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // webextension-polyfill throws outside a real extension runtime;
      // every test runs against the mutable fake instead.
      "webextension-polyfill": path.resolve(__dirname, "tests/polyfillMock.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 3: Create test plumbing, entrypoints and icons**

`clients/extension/tests/polyfillMock.ts`:

```ts
// Alias target for "webextension-polyfill" in vitest. Tests install a fake
// via setFakeBrowser(); anything unset throws loudly instead of silently
// succeeding.
let current: unknown = undefined;

export function setFakeBrowser(fake: unknown): void {
  current = fake;
}

const browser: unknown = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (current === undefined) {
        throw new Error(`webextension-polyfill.${prop} used without setFakeBrowser()`);
      }
      return (current as Record<string, unknown>)[prop];
    },
  },
);

export default browser;
```

`clients/extension/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";

// jsdom has no matchMedia; theme code guards on it but components may call it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
```

`clients/extension/src/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>CrossClipper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`clients/extension/src/popup/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`clients/extension/src/popup/App.tsx` (placeholder, replaced in Task 9):

```tsx
export default function App() {
  return (
    <div>
      <header>⧉ CrossClipper</header>
    </div>
  );
}
```

Wait — the test asserts text `"CrossClipper"`; `⧉ CrossClipper` contains it via substring? `getByText("CrossClipper")` matches whole text content by default. Use a nested span so the accessible text node matches exactly:

```tsx
export default function App() {
  return (
    <div>
      <header>
        <span aria-hidden>⧉</span> <span>CrossClipper</span>
      </header>
    </div>
  );
}
```

`clients/extension/src/background/index.ts` (placeholder, replaced in Task 13):

```ts
console.log("CrossClipper worker booted");
```

`clients/extension/scripts/make-icons.mjs` (placeholder solid-amber icons; no deps — raw PNG chunks + zlib):

```js
// Generates public/icons/icon-{16,48,128}.png as solid amber squares.
// Placeholder art until store-publication assets exist (extension spec §10).
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const png = (size, [r, g, b]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.from([0, ...Array(size).fill([r, g, b]).flat()]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png(size, [217, 119, 6]));
}
console.log("icons written");
```

Run: `npm install` (root) then `npm run icons --workspace @crossclipper/extension` and commit the generated PNGs (small binaries; LOC-exempt).

- [ ] **Step 4: Run test + typecheck + build to verify**

```bash
npm run test --workspace @crossclipper/extension        # scaffold test PASSES
npm run build --workspace @crossclipper/extension       # dist/ contains manifest.json, icons, popup html, worker js
ls clients/extension/dist/manifest.json
```

Expected: test green; build emits `dist/` with a `src/popup/index.html`-derived page and a compiled service worker.

- [ ] **Step 5: Add the CI job**

In `.github/workflows/ci.yml`, add (alongside the existing jobs; if Phase 1 already added a JS job that runs `npm ci` + core tests, add only the extension steps to it instead of duplicating the checkout/setup):

```yaml
  extension:
    name: Extension (test + build)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck --workspace @crossclipper/extension
      - run: npm run test --workspace @crossclipper/extension
      - run: npm run build --workspace @crossclipper/extension
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json clients/extension .github/workflows/ci.yml .gitignore
git commit -m "feat(extension): scaffold MV3 workspace with vite, crxjs and vitest"
```

## Task 6: Design tokens + theme engine (`src/theme/`)

The token **names** here are the cross-client contract (extension spec §7) — desktop and mobile re-implement these names.

**Files:**
- Create: `clients/extension/src/theme/tokens.css`
- Create: `clients/extension/src/theme/theme.ts`
- Test: `clients/extension/tests/theme.test.ts`

**Interfaces:**
- Produces:
  - `type ThemeSetting = "light" | "dark" | "auto"`; `interface Appearance { theme: ThemeSetting; accent: string }`
  - `DEFAULT_APPEARANCE: Appearance` (= `{ theme: "auto", accent: "#d97706" }`), `APPEARANCE_MIRROR_KEY = "cc.appearance"`
  - `resolveTheme(setting, prefersDark) -> "light" | "dark"`; `hexToRgb(hex) -> [r,g,b] | null`; `accentForeground(hex) -> string`; `accentSoft(hex, alpha?) -> string`
  - `applyAppearance(a: Appearance, root?: HTMLElement): void` — sets `data-theme` + `--accent/--accent-fg/--accent-soft`
  - `loadAppearanceSync(): Appearance` (localStorage mirror, pre-paint safe); `initTheme(): void` (apply + follow scheme changes)
- Consumed by: `main.tsx` (init), Task 12 `saveAppearance`, Task 17 `ThemeControls`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  accentForeground,
  accentSoft,
  applyAppearance,
  hexToRgb,
  loadAppearanceSync,
  resolveTheme,
} from "../src/theme/theme";

describe("theme resolution", () => {
  it("auto follows the system scheme", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });
  it("manual override wins over the system scheme", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("accent derivation", () => {
  it("parses hex", () => {
    expect(hexToRgb("#d97706")).toEqual([217, 119, 6]);
    expect(hexToRgb("nonsense")).toBeNull();
  });
  it("default amber gets white foreground; light accents get dark foreground", () => {
    expect(accentForeground("#d97706")).toBe("#ffffff");
    expect(accentForeground("#fde047")).toBe("#1c1917"); // light yellow
  });
  it("soft accent is a translucent tint of the accent", () => {
    expect(accentSoft("#d97706")).toBe("rgba(217, 119, 6, 0.14)");
  });
});

describe("applyAppearance", () => {
  it("sets data-theme and the three accent custom properties", () => {
    const root = document.createElement("div");
    applyAppearance({ theme: "dark", accent: "#2563eb" }, root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--accent")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--accent-fg")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--accent-soft")).toBe("rgba(37, 99, 235, 0.14)");
  });
  it("falls back to default amber on an unparseable accent", () => {
    const root = document.createElement("div");
    applyAppearance({ theme: "light", accent: "garbage" }, root);
    expect(root.style.getPropertyValue("--accent")).toBe(DEFAULT_APPEARANCE.accent);
  });
});

describe("appearance mirror", () => {
  it("returns defaults when the mirror is empty or corrupt", () => {
    localStorage.removeItem("cc.appearance");
    expect(loadAppearanceSync()).toEqual(DEFAULT_APPEARANCE);
    localStorage.setItem("cc.appearance", "{not json");
    expect(loadAppearanceSync()).toEqual(DEFAULT_APPEARANCE);
  });
  it("merges a stored partial over defaults", () => {
    localStorage.setItem("cc.appearance", JSON.stringify({ accent: "#16a34a" }));
    expect(loadAppearanceSync()).toEqual({ theme: "auto", accent: "#16a34a" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — cannot resolve `../src/theme/theme`.

- [ ] **Step 3: Implement tokens and theme engine**

`clients/extension/src/theme/tokens.css`:

```css
/* CrossClipper design tokens — the cross-client contract (extension spec §7).
   Token NAMES are shared with desktop/mobile; values are the extension's
   reference implementation. Slate neutral chassis + user accent. */
:root {
  /* neutrals (slate, light) */
  --bg: #f1f5f9;
  --surface: #ffffff;
  --surface-raised: #f8fafc;
  --border: #e2e8f0;
  --text: #0f172a;
  --text-muted: #64748b;
  /* semantic */
  --success: #16a34a;
  --danger: #dc2626;
  /* accent (overridden at runtime from the user's choice; default amber) */
  --accent: #d97706;
  --accent-fg: #ffffff;
  --accent-soft: rgba(217, 119, 6, 0.14);
  /* radii + spacing scale */
  --radius-sm: 6px;
  --radius-md: 10px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --font-ui: system-ui, -apple-system, "Segoe UI", sans-serif;
}

:root[data-theme="dark"] {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface-raised: #334155;
  --border: #334155;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --success: #4ade80;
  --danger: #f87171;
}
```

`clients/extension/src/theme/theme.ts`:

```ts
export type ThemeSetting = "light" | "dark" | "auto";

export interface Appearance {
  theme: ThemeSetting;
  accent: string;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "auto", accent: "#d97706" };

/** localStorage mirror of the storage.local appearance — lets the popup apply
 *  the theme synchronously before first paint (storage.local is async-only). */
export const APPEARANCE_MIRROR_KEY = "cc.appearance";

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): "light" | "dark" {
  return setting === "auto" ? (prefersDark ? "dark" : "light") : setting;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG relative luminance → readable text color on the accent. */
export function accentForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? "#1c1917" : "#ffffff";
}

export function accentSoft(hex: string, alpha = 0.14): string {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_APPEARANCE.accent)!;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function applyAppearance(
  a: Appearance,
  root: HTMLElement = document.documentElement,
): void {
  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  root.dataset.theme = resolveTheme(a.theme, prefersDark);
  const accent = hexToRgb(a.accent) ? a.accent : DEFAULT_APPEARANCE.accent;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-fg", accentForeground(accent));
  root.style.setProperty("--accent-soft", accentSoft(accent));
}

export function loadAppearanceSync(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_MIRROR_KEY);
    if (raw) return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    /* corrupt mirror → defaults */
  }
  return DEFAULT_APPEARANCE;
}

/** Called at the very top of popup main.tsx — applies before first paint and
 *  re-applies when the OS scheme flips while the popup is open. */
export function initTheme(): void {
  applyAppearance(loadAppearanceSync());
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyAppearance(loadAppearanceSync()));
}
```

Update `clients/extension/src/popup/main.tsx` — add as the FIRST imports/statements:

```tsx
import "../theme/tokens.css";
import { initTheme } from "../theme/theme";

initTheme();
```

(before the React imports and `createRoot` call).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src/theme clients/extension/src/popup/main.tsx clients/extension/tests/theme.test.ts
git commit -m "feat(extension): design tokens and theme engine with runtime accent derivation"
```

### PR 3 checkpoint

- [ ] `npm run test/typecheck/build --workspace @crossclipper/extension` green; CI job added.
- [ ] **STOP — Diego review**, then push + PR `feat(extension): MV3 scaffold, design tokens and theme engine`.

---

# PR 4 — Popup UI components (static, fixture data)

**Needs:** Phase 1 PR 6 merged (`@crossclipper/core` exists — used for **type-only** imports of `Item`/`Device`). No sync logic consumed yet.

Add the dependency now — in `clients/extension/package.json` `dependencies`, add `"@crossclipper/core": "*"`, then `npm install`. (First step of Task 7, part of its commit.)

## Task 7: Formatting utilities + FeedCard

**Files:**
- Create: `clients/extension/src/shared/model.ts`
- Create: `clients/extension/src/popup/format.tsx`
- Create: `clients/extension/src/popup/components/FeedCard.tsx`
- Test: `clients/extension/tests/format.test.tsx`, `clients/extension/tests/feedCard.test.tsx`
- Modify: `clients/extension/package.json` (add `@crossclipper/core`)

**Interfaces:**
- Consumes: `Item`, `Device` types from `@crossclipper/core`.
- Produces:
  - `model.ts`: `interface DeviceView { id: string; name: string; platform: string; online: boolean; isSelf: boolean; lastSeenAt: string }`; `parseUtc(iso: string): Date`; `toDeviceView(d: Device, selfId: string | null): DeviceView`; `platformIcon(platform: string): string` (extension 🌐, windows 💻, ios/android 📱, other ⧉)
  - `format.tsx`: `relativeTime(iso: string, now?: Date): string`; `detectKind(body: string): "text" | "link"`; `linkify(text: string): ReactNode[]`
  - `FeedCard.tsx`: `interface FeedEntry { item: Item; sendState?: "pending" | "failed" }`; `interface FeedCardProps { entry: FeedEntry; originName: string; originIcon: string; onCopy(body: string): void | Promise<void>; onOpen(url: string): void; onDelete(id: string): void; onRetry?(id: string): void }`; `function FeedCard(props: FeedCardProps)`

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/format.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { detectKind, linkify, relativeTime } from "../src/popup/format";
import { parseUtc, platformIcon, toDeviceView } from "../src/shared/model";
import type { Device } from "@crossclipper/core";

const NOW = new Date("2026-07-03T12:00:00Z");

describe("relativeTime", () => {
  it("buckets naive-UTC timestamps", () => {
    expect(relativeTime("2026-07-03T11:59:50", NOW)).toBe("just now");
    expect(relativeTime("2026-07-03T11:58:00", NOW)).toBe("2m ago");
    expect(relativeTime("2026-07-03T09:00:00", NOW)).toBe("3h ago");
    expect(relativeTime("2026-07-01T12:00:00", NOW)).toBe("2d ago");
  });
  it("treats missing timezone as UTC", () => {
    expect(parseUtc("2026-07-03T11:00:00").toISOString()).toBe("2026-07-03T11:00:00.000Z");
  });
});

describe("detectKind", () => {
  it("a lone URL is a link; anything else is text", () => {
    expect(detectKind("https://example.com/a?b=1")).toBe("link");
    expect(detectKind("  http://host/path  ")).toBe("link");
    expect(detectKind("see https://example.com now")).toBe("text");
    expect(detectKind("plain note")).toBe("text");
  });
});

describe("linkify", () => {
  it("wraps embedded URLs in anchors", () => {
    const nodes = linkify("see https://example.com now");
    expect(nodes).toHaveLength(3);
  });
});

describe("device view", () => {
  const device: Device = {
    id: "d1",
    name: "Work laptop",
    platform: "extension",
    online: true,
    last_seen_at: "2026-07-03T11:59:00",
    created_at: "2026-07-01T00:00:00",
  } as Device;
  it("passes through the server's live presence flag", () => {
    expect(toDeviceView(device, "d1").online).toBe(true);
    expect(toDeviceView({ ...device, online: false } as Device, "d1").online).toBe(false);
  });
  it("marks self and picks platform icons", () => {
    expect(toDeviceView(device, "d1").isSelf).toBe(true);
    expect(toDeviceView(device, "other").isSelf).toBe(false);
    expect(platformIcon("windows")).toBe("💻");
    expect(platformIcon("mystery")).toBe("⧉");
  });
});
```

`clients/extension/tests/feedCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { FeedCard } from "../src/popup/components/FeedCard";

const base = {
  originName: "Pixel 8",
  originIcon: "📱",
  onCopy: vi.fn(),
  onOpen: vi.fn(),
  onDelete: vi.fn(),
};

const item = (over: Partial<Item>): Item =>
  ({
    id: "01J0000000000000000000000",
    kind: "text",
    body: "meeting notes draft",
    origin_device_id: "d2",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T11:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

describe("FeedCard", () => {
  it("text items get Copy and Delete, no Open", () => {
    render(<FeedCard {...base} entry={{ item: item({}) }} />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open/i })).not.toBeInTheDocument();
  });

  it("link items additionally get Open, and Open receives the URL", async () => {
    render(
      <FeedCard {...base} entry={{ item: item({ kind: "link", body: "https://example.com" }) }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(base.onOpen).toHaveBeenCalledWith("https://example.com");
  });

  it("copy flashes a confirmation", async () => {
    render(<FeedCard {...base} entry={{ item: item({}) }} />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(base.onCopy).toHaveBeenCalledWith("meeting notes draft");
    expect(await screen.findByText(/copied ✓/i)).toBeInTheDocument();
  });

  it("unknown kinds render the update-client fallback", () => {
    render(<FeedCard {...base} entry={{ item: item({ kind: "image" as Item["kind"] }) }} />);
    expect(screen.getByText(/unsupported item — update client/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("failed sends show the retry affordance instead of actions", async () => {
    const onRetry = vi.fn();
    render(<FeedCard {...base} onRetry={onRetry} entry={{ item: item({}), sendState: "failed" }} />);
    await userEvent.click(screen.getByRole("button", { name: /not sent — tap to retry/i }));
    expect(onRetry).toHaveBeenCalledWith("01J0000000000000000000000");
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("shows origin device and relative time in the header", () => {
    render(<FeedCard {...base} entry={{ item: item({}) }} />);
    expect(screen.getByText(/Pixel 8/)).toBeInTheDocument();
    expect(screen.getByText(/ago|just now/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`clients/extension/src/shared/model.ts`:

```ts
import type { Device } from "@crossclipper/core";

/** Presence is live server truth (plan decision 2): GET /devices carries `online`
 *  (device holds an open WS) and device_changed fires on presence transitions,
 *  so the cached device list is always fresh. last_seen_at is display-only. */
export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  isSelf: boolean;
  lastSeenAt: string;
}

/** Server timestamps are naive UTC (Phase 1 decision 12) — pin the zone. */
export function parseUtc(iso: string): Date {
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasZone ? iso : `${iso}Z`);
}

export function toDeviceView(d: Device, selfId: string | null): DeviceView {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    lastSeenAt: d.last_seen_at,
    online: d.online,
    isSelf: d.id === selfId,
  };
}

export function platformIcon(platform: string): string {
  switch (platform) {
    case "extension":
      return "🌐";
    case "windows":
      return "💻";
    case "ios":
    case "android":
      return "📱";
    default:
      return "⧉";
  }
}
```

`clients/extension/src/popup/format.tsx`:

```tsx
import type { ReactNode } from "react";
import { parseUtc } from "../shared/model";

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - parseUtc(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return parseUtc(iso).toLocaleDateString();
}

const LONE_URL = /^https?:\/\/\S+$/;
const URL_IN_TEXT = /(https?:\/\/[^\s]+)/g;

export function detectKind(body: string): "text" | "link" {
  return LONE_URL.test(body.trim()) ? "link" : "text";
}

/** Split text into nodes, wrapping URLs in anchors (extension spec §3). */
export function linkify(text: string): ReactNode[] {
  return text.split(URL_IN_TEXT).map((part, i) =>
    URL_IN_TEXT.test(part) && /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
```

(Note: `URL_IN_TEXT.test` on a `g` regex is stateful — reset by testing a fresh anchor check as shown, or use `/^https?:\/\//.test(part)` alone as the discriminator; the split pattern guarantees odd indices are URLs, so the simplest correct form is `i % 2 === 1`. Use that:)

```tsx
export function linkify(text: string): ReactNode[] {
  return text.split(URL_IN_TEXT).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
```

`clients/extension/src/popup/components/FeedCard.tsx`:

```tsx
import { useState } from "react";
import type { Item } from "@crossclipper/core";
import { linkify, relativeTime } from "../format";

export interface FeedEntry {
  item: Item;
  sendState?: "pending" | "failed";
}

export interface FeedCardProps {
  entry: FeedEntry;
  originName: string;
  originIcon: string;
  onCopy(body: string): void | Promise<void>;
  onOpen(url: string): void;
  onDelete(id: string): void;
  onRetry?(id: string): void;
}

export function FeedCard({
  entry,
  originName,
  originIcon,
  onCopy,
  onOpen,
  onDelete,
  onRetry,
}: FeedCardProps) {
  const { item, sendState } = entry;
  const [copied, setCopied] = useState(false);

  if (item.kind !== "text" && item.kind !== "link") {
    return (
      <article className="card card-unsupported">
        <p className="text-muted">Unsupported item — update client</p>
      </article>
    );
  }

  const copy = async () => {
    await onCopy(item.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="card">
      <header className="card-header">
        <span className="card-origin">
          <span aria-hidden>{originIcon}</span> {originName}
        </span>
        <time className="text-muted">{relativeTime(item.created_at)}</time>
      </header>
      <p className="card-body">{linkify(item.body)}</p>
      {sendState === "failed" && onRetry ? (
        <button className="card-retry danger" onClick={() => onRetry(item.id)}>
          not sent — tap to retry
        </button>
      ) : (
        <footer className="card-actions">
          <button onClick={() => void copy()} aria-label={copied ? "Copied ✓" : "Copy"}>
            {copied ? "Copied ✓" : "⧉ Copy"}
          </button>
          {item.kind === "link" && (
            <button onClick={() => onOpen(item.body)} aria-label="Open">
              ↗ Open
            </button>
          )}
          <button
            className="danger"
            aria-label="Delete"
            disabled={sendState === "pending"}
            onClick={() => onDelete(item.id)}
          >
            🗑
          </button>
        </footer>
      )}
      {sendState === "pending" && <span className="text-muted card-pending">sending…</span>}
    </article>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests clients/extension/package.json package-lock.json
git commit -m "feat(extension): feed card with kind-aware actions and formatting utilities"
```

## Task 8: DeviceRail, TargetPicker and Compose

**Files:**
- Create: `clients/extension/src/popup/components/DeviceRail.tsx`
- Create: `clients/extension/src/popup/components/TargetPicker.tsx`
- Create: `clients/extension/src/popup/components/Compose.tsx`
- Test: `clients/extension/tests/railComposeTarget.test.tsx`

**Interfaces:**
- Consumes: `DeviceView`, `platformIcon` (Task 7); `detectKind` (Task 7).
- Produces:
  - `DeviceRail({ devices: DeviceView[]; selected: string | null; onSelect(id: string | null): void })` — "All" + one button per device with presence dot; `selected === null` ⇒ All.
  - `TargetPicker({ devices: DeviceView[]; target: string | null; onChange(id: string | null): void })` — "Silent" chip + one chip per non-self device.
  - `Compose({ devices: DeviceView[]; onSend(kind: "text" | "link", body: string, targetDeviceId: string | null): void })` — Enter sends (and resets body + target), Shift+Enter newline, empty sends ignored.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/railComposeTarget.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Compose } from "../src/popup/components/Compose";
import { DeviceRail } from "../src/popup/components/DeviceRail";
import { TargetPicker } from "../src/popup/components/TargetPicker";
import type { DeviceView } from "../src/shared/model";

const devices: DeviceView[] = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, isSelf: true, lastSeenAt: "2026-07-03T11:59:00" },
  { id: "d2", name: "Pixel 8", platform: "android", online: false, isSelf: false, lastSeenAt: "2026-07-01T00:00:00" },
];

describe("DeviceRail", () => {
  it("renders All plus every device and reports selection", async () => {
    const onSelect = vi.fn();
    render(<DeviceRail devices={devices} selected={null} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /all/i })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    expect(onSelect).toHaveBeenCalledWith("d2");
  });
  it("shows presence dots", () => {
    render(<DeviceRail devices={devices} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /work laptop/i }).querySelector(".dot-online")).toBeTruthy();
    expect(screen.getByRole("button", { name: /pixel 8/i }).querySelector(".dot-offline")).toBeTruthy();
  });
});

describe("TargetPicker", () => {
  it("defaults to Silent and excludes the current device", () => {
    render(<TargetPicker devices={devices} target={null} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /silent/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /work laptop/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pixel 8/i })).toBeInTheDocument();
  });
  it("selecting a chip reports the device id", async () => {
    const onChange = vi.fn();
    render(<TargetPicker devices={devices} target={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    expect(onChange).toHaveBeenCalledWith("d2");
  });
});

describe("Compose", () => {
  it("Enter sends trimmed text and resets body and target", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "  hello world  {Enter}");
    expect(onSend).toHaveBeenCalledWith("text", "hello world", "d2");
    expect(box).toHaveValue("");
    expect(screen.getByRole("button", { name: /silent/i })).toHaveAttribute("aria-pressed", "true");
  });
  it("Shift+Enter inserts a newline instead of sending", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox"), "line1{Shift>}{Enter}{/Shift}line2");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("line1\nline2");
  });
  it("a lone URL is sent as a link; empty input is ignored", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox"), "https://example.com{Enter}");
    expect(onSend).toHaveBeenCalledWith("link", "https://example.com", null);
    await userEvent.type(screen.getByRole("textbox"), "   {Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three components**

`clients/extension/src/popup/components/DeviceRail.tsx`:

```tsx
import type { DeviceView } from "../../shared/model";
import { platformIcon } from "../../shared/model";

export interface DeviceRailProps {
  devices: DeviceView[];
  selected: string | null;
  onSelect(id: string | null): void;
}

export function DeviceRail({ devices, selected, onSelect }: DeviceRailProps) {
  return (
    <nav className="rail" aria-label="Devices">
      <button aria-pressed={selected === null} onClick={() => onSelect(null)}>
        All
      </button>
      {devices.map((d) => (
        <button key={d.id} aria-pressed={selected === d.id} onClick={() => onSelect(d.id)} title={d.name}>
          <span aria-hidden>{platformIcon(d.platform)}</span>
          <span className="rail-name">{d.name}</span>
          <span className={d.online ? "dot dot-online" : "dot dot-offline"} aria-hidden />
        </button>
      ))}
    </nav>
  );
}
```

`clients/extension/src/popup/components/TargetPicker.tsx`:

```tsx
import type { DeviceView } from "../../shared/model";
import { platformIcon } from "../../shared/model";

export interface TargetPickerProps {
  devices: DeviceView[];
  target: string | null;
  onChange(id: string | null): void;
}

/** The standard target picker (system spec §4): chips defaulting to Silent.
 *  Targeting controls which device gets ALERTED — never visibility. */
export function TargetPicker({ devices, target, onChange }: TargetPickerProps) {
  return (
    <div className="chips" role="group" aria-label="Notify device">
      <button className="chip" aria-pressed={target === null} onClick={() => onChange(null)}>
        Silent
      </button>
      {devices
        .filter((d) => !d.isSelf)
        .map((d) => (
          <button
            key={d.id}
            className="chip"
            aria-pressed={target === d.id}
            onClick={() => onChange(d.id)}
          >
            <span aria-hidden>{platformIcon(d.platform)}</span> {d.name}
          </button>
        ))}
    </div>
  );
}
```

`clients/extension/src/popup/components/Compose.tsx`:

```tsx
import { useState } from "react";
import type { DeviceView } from "../../shared/model";
import { detectKind } from "../format";
import { TargetPicker } from "./TargetPicker";

export interface ComposeProps {
  devices: DeviceView[];
  onSend(kind: "text" | "link", body: string, targetDeviceId: string | null): void;
}

export function Compose({ devices, onSend }: ComposeProps) {
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const rows = Math.min(4, body.split("\n").length);

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSend(detectKind(trimmed), trimmed, target);
    setBody("");
    setTarget(null); // silent-by-default: reset after each send
  };

  return (
    <div className="compose">
      <TargetPicker devices={devices} target={target} onChange={setTarget} />
      <div className="compose-row">
        <textarea
          rows={rows}
          value={body}
          placeholder="Type or paste…"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button aria-label="Send" onClick={send}>
          ➤
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): device rail, target picker and compose components"
```

## Task 9: Popup shell — layout, styles, fixtures, edge states

**Files:**
- Create: `clients/extension/src/popup/popup.css`
- Create: `clients/extension/src/popup/fixtures.ts`
- Create: `clients/extension/src/popup/components/Banner.tsx`
- Modify: `clients/extension/src/popup/App.tsx` (real shell over fixtures), `clients/extension/src/popup/main.tsx` (import popup.css)
- Test: `clients/extension/tests/appStatic.test.tsx`

**Interfaces:**
- Consumes: all Task 7–8 components.
- Produces: `Banner({ kind: "reconnecting" | "version"; message?: string })`; App shell layout (header ⚙ / rail / feed / compose) driven by a `FIXTURES` module — replaced by live state in Task 15; fixtures exported as `fixtureDevices: DeviceView[]`, `fixtureEntries: FeedEntry[]` for reuse in tests.

- [ ] **Step 1: Write the failing test**

`clients/extension/tests/appStatic.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../src/popup/App";

describe("popup shell (fixtures)", () => {
  it("renders header, rail, feed cards and compose", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /all/i })).toBeInTheDocument();
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("rail selection filters the feed by origin device", async () => {
    render(<App />);
    const before = screen.getAllByRole("article").length;
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    expect(screen.getAllByRole("article").length).toBeLessThan(before);
  });

  it("shows the empty-state hint when the filter matches nothing", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /old tablet/i }));
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — App is still the Task 5 placeholder (no rail/feed/compose).

- [ ] **Step 3: Implement fixtures, styles, banner and shell**

`clients/extension/src/popup/fixtures.ts`:

```ts
import type { Item } from "@crossclipper/core";
import type { FeedEntry } from "./components/FeedCard";
import type { DeviceView } from "../shared/model";

export const fixtureDevices: DeviceView[] = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, isSelf: true, lastSeenAt: "2026-07-03T11:59:30" },
  { id: "d2", name: "Pixel 8", platform: "android", online: true, isSelf: false, lastSeenAt: "2026-07-03T11:58:00" },
  { id: "d3", name: "Old tablet", platform: "other", online: false, isSelf: false, lastSeenAt: "2026-06-01T00:00:00" },
];

const item = (id: string, over: Partial<Item>): Item =>
  ({
    id,
    kind: "text",
    body: "",
    origin_device_id: "self",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T11:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

export const fixtureEntries: FeedEntry[] = [
  { item: item("01J2", { kind: "link", body: "https://example.com/article", origin_device_id: "d2" }) },
  { item: item("01J1", { body: "meeting notes draft — remember the deployment checklist" }) },
];
```

`clients/extension/src/popup/components/Banner.tsx`:

```tsx
export interface BannerProps {
  kind: "reconnecting" | "version";
  message?: string;
}

export function Banner({ kind, message }: BannerProps) {
  return (
    <div className={`banner banner-${kind}`} role="status">
      {kind === "reconnecting" ? "Reconnecting…" : message}
    </div>
  );
}
```

`clients/extension/src/popup/popup.css` (layout essentials; token-driven throughout — no raw colors):

```css
html,
body,
#root {
  margin: 0;
  width: 380px;
  height: 540px;
  font-family: var(--font-ui);
  color: var(--text);
  background: var(--bg);
}
.app { display: grid; grid-template-rows: auto auto 1fr auto; height: 100%; }
.header {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.header button { background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 16px; }
.banner { padding: var(--space-1) var(--space-3); background: var(--accent-soft); color: var(--text); font-size: 12px; }
.main { display: grid; grid-template-columns: 84px 1fr; min-height: 0; }
.rail {
  display: flex; flex-direction: column; gap: var(--space-1);
  padding: var(--space-2); background: var(--surface); border-right: 1px solid var(--border);
  overflow-y: auto;
}
.rail button {
  display: flex; align-items: center; gap: var(--space-1);
  padding: var(--space-1) var(--space-2); border: none; background: none; cursor: pointer;
  border-radius: var(--radius-sm); color: var(--text); font-size: 12px; text-align: left;
}
.rail button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.rail-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-online { background: var(--success); }
.dot-offline { background: var(--border); }
.feed { overflow-y: auto; padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: var(--space-2) var(--space-3);
}
.card-header { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: var(--space-1); }
.card-body {
  margin: 0 0 var(--space-2);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  overflow-wrap: anywhere; font-size: 13px;
}
.card-body a { color: var(--accent); }
.card-actions { display: flex; gap: var(--space-2); }
.card-actions button, .card-retry, .chip, .compose-row button {
  border: 1px solid var(--border); background: var(--surface-raised); color: var(--text);
  border-radius: var(--radius-sm); padding: 2px var(--space-2); cursor: pointer; font-size: 12px;
}
.card-actions button.danger, .card-retry { color: var(--danger); }
.card-new { outline: 2px solid var(--accent-soft); }
.card-pending { font-size: 11px; }
.text-muted { color: var(--text-muted); }
.chips { display: flex; gap: var(--space-1); flex-wrap: wrap; margin-bottom: var(--space-1); }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.compose { padding: var(--space-2) var(--space-3); background: var(--surface); border-top: 1px solid var(--border); }
.compose-row { display: flex; gap: var(--space-2); align-items: flex-end; }
.compose-row textarea {
  flex: 1; resize: none; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--text); padding: var(--space-1) var(--space-2); font-family: inherit;
}
.compose-row button { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.empty { color: var(--text-muted); text-align: center; margin-top: var(--space-5); font-size: 13px; padding: 0 var(--space-4); }
.pill {
  position: sticky; top: 0; align-self: center;
  background: var(--accent); color: var(--accent-fg); border: none;
  border-radius: 999px; padding: 2px var(--space-3); cursor: pointer; font-size: 12px;
}
```

`clients/extension/src/popup/App.tsx` (fixture-driven shell; Task 15 swaps fixtures for live worker state — keep the JSX structure identical):

```tsx
import { useMemo, useState } from "react";
import { DeviceRail } from "./components/DeviceRail";
import { Compose } from "./components/Compose";
import { FeedCard } from "./components/FeedCard";
import { fixtureDevices, fixtureEntries } from "./fixtures";
import { platformIcon } from "../shared/model";

export default function App() {
  const [filter, setFilter] = useState<string | null>(null);
  const devices = fixtureDevices;
  const entries = fixtureEntries;

  const visible = useMemo(
    () => (filter ? entries.filter((e) => e.item.origin_device_id === filter) : entries),
    [entries, filter],
  );
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? "Unknown device";
  const iconOf = (id: string) => platformIcon(devices.find((d) => d.id === id)?.platform ?? "");

  return (
    <div className="app">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <button aria-label="Settings">⚙</button>
      </header>
      <div />
      <div className="main">
        <DeviceRail devices={devices} selected={filter} onSelect={setFilter} />
        <div className="feed">
          {visible.length === 0 && (
            <p className="empty">Copy something on another device, or type below.</p>
          )}
          {visible.map((entry) => (
            <FeedCard
              key={entry.item.id}
              entry={entry}
              originName={nameOf(entry.item.origin_device_id)}
              originIcon={iconOf(entry.item.origin_device_id)}
              onCopy={(body) => void navigator.clipboard.writeText(body)}
              onOpen={(url) => window.open(url)}
              onDelete={() => {}}
            />
          ))}
        </div>
      </div>
      <Compose devices={devices} onSend={() => {}} />
    </div>
  );
}
```

Add `import "./popup.css";` to `clients/extension/src/popup/main.tsx` (after the tokens import).

- [ ] **Step 4: Run tests, typecheck, build; eyeball in a browser**

```bash
npm run test --workspace @crossclipper/extension && npm run build --workspace @crossclipper/extension
```

Expected: all green. Manual check: load `clients/extension/dist/` unpacked in Chrome (`chrome://extensions` → Developer mode → Load unpacked) — popup shows rail/cards/compose at 380×540 with amber accents, and dark mode follows the OS.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): popup shell with fixture feed, layout and token-driven styles"
```

### PR 4 checkpoint

- [ ] Full extension suite + typecheck + build green; manual unpacked-load screenshot for Diego.
- [ ] **STOP — Diego review**, then push + PR `feat(extension): popup UI components with fixture data`.

---
# PR 5 — Protocol prerequisites (server health info + core outbox target)

**Needs:** Phase 1 PRs 6–9 fully merged (touches core source and the committed contract). Two atomic commits — server first, then core.

## Task 10: `/health` reports app identity, version and registration state

**Files:**
- Modify: `server/src/crossclipper/health.py`
- Modify: `server/tests/test_health.py`
- Regenerate: `packages/core/openapi.json` + `packages/core/src/generated/api.ts` (via `scripts/update-api-contract.sh`; generated, LOC-exempt)

**Interfaces:**
- Consumes: `Settings.allow_registration`, `User` model, app engine.
- Produces: `GET /health` → `HealthOut { status: "ok", app: "crossclipper", version: str, registration_open: bool }` (200) — 503 shape unchanged `{code, message}`. `registration_open = allow_registration or zero users exist` (mirrors the register endpoint's gate). Consumed by onboarding (Task 16) and `ApiClient.health()` (Task 11).

- [ ] **Step 1: Write the failing tests**

In `server/tests/test_health.py`, add (adapt imports to the existing file's fixtures — it has `client` / `settings` fixtures from conftest):

```python
def test_health_reports_identity_and_open_registration(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["app"] == "crossclipper"
    assert body["version"]  # non-empty, e.g. "0.1.0"
    assert body["registration_open"] is True  # fresh DB: no user yet


def test_health_registration_closes_after_first_user(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "a@b.c", "password": "password123!"},
    )
    assert client.get("/health").json()["registration_open"] is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && uv run pytest tests/test_health.py -v`
Expected: FAIL — `KeyError: 'app'`.

- [ ] **Step 3: Implement**

Rewrite `server/src/crossclipper/health.py`:

```python
from importlib.metadata import PackageNotFoundError, version as pkg_version

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from crossclipper.db.models import User

router = APIRouter()


def _server_version() -> str:
    try:
        return pkg_version("crossclipper-server")
    except PackageNotFoundError:  # editable/dev edge case
        return "0.0.0"


class HealthOut(BaseModel):
    status: str
    app: str
    version: str
    registration_open: bool


@router.get("/health", response_model=HealthOut)
async def health(request: Request):
    """Readiness + server identity for client onboarding (phase 2 plan, ambiguity 1)."""
    settings = request.app.state.settings
    try:
        with request.app.state.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        probe = settings.blobs_dir / ".health-probe"
        probe.write_text("ok")
        probe.unlink()
        with Session(request.app.state.engine) as session:
            user_count = session.execute(select(func.count(User.id))).scalar_one()
    except Exception as exc:  # noqa: BLE001 — health must never 500
        return JSONResponse(
            status_code=503, content={"code": "unhealthy", "message": str(exc)}
        )
    return HealthOut(
        status="ok",
        app="crossclipper",
        version=_server_version(),
        registration_open=settings.allow_registration or user_count == 0,
    )
```

- [ ] **Step 4: Run server tests — expect the OpenAPI snapshot to fail too**

Run: `cd server && uv run pytest -v`
Expected: health tests PASS; `test_openapi_contract` FAILS (contract drift — that is the snapshot doing its job).

- [ ] **Step 5: Regenerate the contract and types**

Run: `./scripts/update-api-contract.sh`
Expected: `packages/core/openapi.json` and `packages/core/src/generated/api.ts` updated with the `HealthOut` schema. Then `cd server && uv run pytest` fully green and `npm run test --workspace @crossclipper/core` still green.

- [ ] **Step 6: Lint and commit (server + regenerated contract)**

```bash
cd server && uv run ruff check . && uv run ruff format . && cd ..
git add server packages/core/openapi.json packages/core/src/generated/api.ts
git commit -m "feat(server): expose app identity, version and registration state on /health"
```

## Task 10b: Live presence — `online` in the device list, presence broadcasts

*(Added at Diego's plan review — decision 2 upgraded from derived presence to a true protocol.)*

**Files:**
- Modify: `server/src/crossclipper/realtime/hub.py`
- Modify: `server/src/crossclipper/realtime/router.py`
- Modify: `server/src/crossclipper/devices/schemas.py`, `server/src/crossclipper/devices/router.py`
- Test: `server/tests/test_presence.py`
- Regenerate: contract artifacts once for the whole PR, after Tasks 10 + 10b (Task 10 already lists the regen step)

**Interfaces:**
- Produces:
  - `Hub.add(...) -> bool` (true ⇔ this was the device's FIRST socket — offline→online transition); `Hub.remove(...) -> bool` (true ⇔ the device's LAST socket left — online→offline transition); `Hub.is_online(user_id, device_id) -> bool`.
  - WS route broadcasts `{type: "device_changed"}` after a transition-`add` and after a transition-`remove` (in the `finally` cleanup). Non-transition adds/removes (second socket of the same device) broadcast nothing.
  - `DeviceOut.online: bool`; `GET /devices` computes it from the hub per device.
- Consumes: the hub instance already available to the devices router (rename/revoke broadcasts use it today).
- Consumed by: extension presence dots (Tasks 7/8/20) via Task 13's existing `devices_changed` → re-fetch handler — no extension worker changes needed.

Notes that keep this honest:
- Presence is **computed, not stored** — no schema/model change to `Device`; `last_seen_at` keeps its meaning ("last authenticated contact") for the "last seen …" display of offline devices.
- `close_device` (revoke) empties the device's registry entry; the revoke handler already broadcasts `device_changed` afterwards, so no extra broadcast is needed on that path.
- Dead sockets: uvicorn's built-in WS ping keepalive closes silently-dropped connections; the route's `finally` then fires the offline transition broadcast. No custom reaper.
- Broadcast ordering follows the Phase 1 rule trivially: presence is in-memory hub state, updated before the broadcast; there is no DB commit involved.

- [ ] **Step 1: Write the failing tests**

`server/tests/test_presence.py` — hub-level transition semantics with fake sockets (match the fake-socket style of the existing hub tests), plus one endpoint test:

```python
class FakeSocket:
    async def send_json(self, event):  # pragma: no cover - not exercised here
        pass


def test_add_reports_first_socket_only():
    hub = Hub()
    a, b = FakeSocket(), FakeSocket()
    assert hub.add("u1", "d1", a) is True      # offline → online
    assert hub.add("u1", "d1", b) is False     # already online
    assert hub.is_online("u1", "d1") is True


def test_remove_reports_last_socket_only():
    hub = Hub()
    a, b = FakeSocket(), FakeSocket()
    hub.add("u1", "d1", a)
    hub.add("u1", "d1", b)
    assert hub.remove("u1", "d1", a) is False  # still online via b
    assert hub.remove("u1", "d1", b) is True   # online → offline
    assert hub.is_online("u1", "d1") is False


def test_devices_list_reports_live_presence(client):
    # register + login (adapt to conftest fixtures), then:
    devices = client.get("/api/v1/devices", headers=auth).json()["devices"]
    assert devices[0]["online"] is False       # no WS open
    with client.websocket_connect(f"/api/v1/ws?token={token}"):
        devices = client.get("/api/v1/devices", headers=auth).json()["devices"]
        assert devices[0]["online"] is True
    devices = client.get("/api/v1/devices", headers=auth).json()["devices"]
    assert devices[0]["online"] is False       # socket closed → offline again
```

Also assert the broadcast: open device A's socket, then connect device B and receive `{"type": "device_changed"}` on A's socket (and again after B disconnects) — reuse the ping/pong registration guard pattern from the E2E WS journeys if needed at unit level.

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/test_presence.py -v` fails on missing `is_online`/`online`.

- [ ] **Step 3: Implement**

- `hub.py`: `add` returns `len(self._sockets[user_id][device_id]) == 1` after insertion; `remove` returns whether it deleted the device's (now empty) socket set; `is_online` checks the registry.
- `realtime/router.py`: after a transition-`add`, `await hub.broadcast(user_id, {"type": "device_changed"})`; in the `finally`, if `hub.remove(...)` returns true, broadcast the same event (guard with try/except so a failed broadcast never masks socket cleanup).
- `devices/schemas.py`: `online: bool` on `DeviceOut`.
- `devices/router.py`: build each `DeviceOut` with `online=hub.is_online(auth.user_id, device.id)` (explicit construction; `from_attributes` can't source a computed field).

- [ ] **Step 4: Contract regen + full suite green** — covered by Task 10's regen step (run once after both tasks); `uv run pytest` and core `npm test` stay green (core's generated `Device` type gains `online`, which Task 7 consumes).

## Task 11: Core — `ApiClient.health()` and targeted outbox sends

**Files:**
- Modify: `packages/core/src/types.ts` (add `HealthOut` alias)
- Modify: `packages/core/src/api/client.ts` (add `health()`)
- Modify: `packages/core/src/outbox.ts` (`targetDeviceId` support)
- Test: `packages/core/tests/client.test.ts`, `packages/core/tests/outbox.test.ts` (extend)

**Interfaces:**
- Consumes: generated `components["schemas"]["HealthOut"]`; existing `ApiClient` internals; existing `Outbox`/`OutboxEntry`.
- Produces (relied on by extension Tasks 13, 16):
  - `types.ts`: `export type HealthOut = components["schemas"]["HealthOut"];`
  - `ApiClient.health(): Promise<HealthOut>` — GETs **root** `/health` (not under `/api/v1`), no auth header needed, throws `NetworkError` on transport failure and `ApiError` on non-2xx.
  - `Outbox.send(kind: "text" | "link", body: string, targetDeviceId?: string): Promise<string>`; `OutboxEntry` gains optional `target_device_id?: string`; flush passes it to `createItem`. Match the field name the Phase 1 amendment settled on in `createItem`'s input — if the merged core uses `target_device_id` in the input object, pass that key; adjust the property name accordingly before implementing.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/client.test.ts` (reuse the file's existing fake-fetch helper style):

```ts
describe("health", () => {
  it("GETs root /health without the /api/v1 prefix", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ status: "ok", app: "crossclipper", version: "0.1.0", registration_open: true }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new ApiClient({ baseUrl: "http://s", fetchFn });
    const out = await client.health();
    expect(calls).toEqual(["http://s/health"]);
    expect(out.app).toBe("crossclipper");
    expect(out.registration_open).toBe(true);
  });

  it("maps transport failure to NetworkError and 503 to ApiError", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(new ApiClient({ baseUrl: "http://s", fetchFn: boom }).health()).rejects.toBeInstanceOf(
      NetworkError,
    );
    const sick = (async () =>
      new Response(JSON.stringify({ code: "unhealthy", message: "db" }), { status: 503 })) as typeof fetch;
    await expect(new ApiClient({ baseUrl: "http://s", fetchFn: sick }).health()).rejects.toMatchObject({
      status: 503,
      code: "unhealthy",
    });
  });
});
```

Append to `packages/core/tests/outbox.test.ts` (reuse its existing FakeServer/spy-client helpers):

```ts
it("carries the notification target through to createItem and persists it", async () => {
  const created: Array<Record<string, unknown>> = [];
  const client = {
    createItem: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: input.id, kind: input.kind, body: input.body } as Item;
    },
  } as unknown as ApiClient;
  const storage = new MemoryStorage();
  const outbox = new Outbox({ client, storage, ulidFn: () => "01TARGETULID000000000000000" });
  await outbox.load();
  await outbox.send("text", "ping", "device-b");
  await outbox.flush();
  expect(created[0]).toMatchObject({ body: "ping", target_device_id: "device-b" });

  // untargeted sends omit the field entirely
  await outbox.send("text", "silent one");
  await outbox.flush();
  expect("target_device_id" in created[1]!).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — `client.health is not a function`; outbox target assertion fails.

- [ ] **Step 3: Implement**

`packages/core/src/types.ts` — add:

```ts
export type HealthOut = components["schemas"]["HealthOut"];
```

`packages/core/src/api/client.ts` — add the import of `HealthOut` and this method to `ApiClient`:

```ts
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
```

`packages/core/src/outbox.ts` — three changes:

```ts
export interface OutboxEntry {
  id: string;
  kind: "text" | "link";
  body: string;
  target_device_id?: string;
  attempts: number;
}
```

```ts
  async send(kind: "text" | "link", body: string, targetDeviceId?: string): Promise<string> {
    const id = (this.deps.ulidFn ?? ulid)();
    const entry: OutboxEntry = { id, kind, body, attempts: 0 };
    if (targetDeviceId) entry.target_device_id = targetDeviceId;
    this.entries.push(entry);
    await this.persist();
    void this.flush();
    return id;
  }
```

And in `flush()`, the `createItem` call becomes:

```ts
          const item = await this.deps.client.createItem({
            id: entry.id,
            kind: entry.kind,
            body: entry.body,
            ...(entry.target_device_id ? { target_device_id: entry.target_device_id } : {}),
          });
```

(If the merged Phase 1 `createItem` input names the field differently — check `packages/core/src/api/client.ts` — use that exact name in both the spread and the test.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: all pass (existing outbox scenarios untouched — old persisted entries without the field still parse).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests
git commit -m "feat(core): ApiClient.health() and notification-target support in the outbox"
```

### PR 5 checkpoint

- [ ] `cd server && uv run pytest` green (snapshot updated); full JS suite + typecheck green.
- [ ] **STOP — Diego review**, then push + PR `feat(protocol): health server info and targeted outbox sends`.

---

# PR 6 — Background worker owning the core sync engine

**Needs:** Phase 1 PRs 6–9 + this plan's PR 5 merged.

## Task 12: Shared plumbing — storage adapter, settings, messages, FeedStore

**Files:**
- Create: `clients/extension/src/shared/storage.ts`
- Create: `clients/extension/src/shared/settings.ts`
- Create: `clients/extension/src/shared/messages.ts`
- Create: `clients/extension/src/background/feedStore.ts`
- Create: `clients/extension/tests/fakeBrowser.ts`
- Test: `clients/extension/tests/messages.test.ts`, `clients/extension/tests/feedStore.test.ts`, `clients/extension/tests/settingsStore.test.ts`

**Interfaces:**
- Consumes: `SyncStorage`, `SyncStatus`, `Item`, `Device`, `OutboxEntry` from `@crossclipper/core`; `Appearance`, `APPEARANCE_MIRROR_KEY`, `applyAppearance` from theme.
- Produces (the contract Tasks 13–21 build on):
  - `storage.ts`: `class ExtensionStorage implements SyncStorage` over `browser.storage.local` (keys used verbatim — core already namespaces `cc.cursor` / `cc.outbox`); constructor accepts an optional storage-area override for tests: `constructor(area?: { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> })`.
  - `settings.ts`:
    ```ts
    export interface AuthState { baseUrl: string; token: string; deviceId: string; deviceName: string }
    export interface Prefs { notifyOnNewItems: boolean; contextMenuSend: boolean }
    export const DEFAULT_PREFS: Prefs = { notifyOnNewItems: false, contextMenuSend: true };
    export const AUTH_KEY = "cc.auth"; export const PREFS_KEY = "cc.prefs";
    export const APPEARANCE_KEY = "cc.appearanceStored"; export const SERVER_VERSION_KEY = "cc.serverVersion";
    loadAuth(): Promise<AuthState | null>; saveAuth(a: AuthState): Promise<void>; clearAuth(): Promise<void>;
    loadPrefs(): Promise<Prefs>; savePrefs(patch: Partial<Prefs>): Promise<Prefs>;
    saveAppearance(a: Appearance): Promise<void>  // storage.local + localStorage mirror (if present) + applyAppearance
    loadAppearanceStored(): Promise<Appearance>
    ```
  - `messages.ts`:
    ```ts
    export const EVENTS_PORT = "cc-events";
    export interface PendingSend { id: string; kind: "text" | "link"; body: string; targetDeviceId: string | null; failed: boolean; errorMessage?: string }
    export interface StateSnapshot { authed: boolean; baseUrl: string | null; deviceId: string | null; status: SyncStatus; items: Item[]; pending: PendingSend[]; devices: Device[] }
    export type PopupRequest =
      | { type: "get_state" } | { type: "refresh" }
      | { type: "send"; kind: "text" | "link"; body: string; targetDeviceId: string | null }
      | { type: "retry"; outboxId: string }
      | { type: "delete_item"; itemId: string }
      | { type: "rename_device"; deviceId: string; name: string }
      | { type: "revoke_device"; deviceId: string }
      | { type: "sign_out" };
    export type WorkerEvent =
      | { type: "snapshot"; state: StateSnapshot }
      | { type: "item"; item: Item } | { type: "item_deleted"; itemId: string }
      | { type: "status"; status: SyncStatus }
      | { type: "outbox_changed"; pending: PendingSend[] }
      | { type: "devices"; devices: Device[] }
      | { type: "auth_required" };
    export function isPopupRequest(v: unknown): v is PopupRequest;
    export function isWorkerEvent(v: unknown): v is WorkerEvent;
    export function requestWorker<T = unknown>(req: PopupRequest): Promise<T>;  // browser.runtime.sendMessage
    ```
  - `feedStore.ts`: `class FeedStore { constructor(storage: SyncStorage); init(): Promise<void>; upsert(item: Item): Promise<boolean>; remove(id: string): Promise<boolean>; list(): Item[]; clear(): Promise<void> }` — newest-first (ULID desc), dedup by id, tombstone-wins (a removed id can't be re-upserted), capped at `MAX_ITEMS = 1000`, persisted under `cc.items`.
  - `fakeBrowser.ts`: `makeFakeBrowser()` returning `{ browser, storageData }` — in-memory `storage.local` (get/set/remove + onChanged listeners), `runtime` (onMessage/onConnect/sendMessage wired to registered listeners, `makePort(name)` helper), `alarms`, `notifications`, `action`, `contextMenus`, `permissions`, `tabs`, `windows` stubs that record calls in arrays. Tests call `setFakeBrowser(browser)` from `tests/polyfillMock.ts`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/feedStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import { FeedStore, MAX_ITEMS } from "../src/background/feedStore";

const item = (id: string): Item => ({ id, kind: "text", body: id, origin_device_id: "d", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null }) as Item;

describe("FeedStore", () => {
  it("dedups by id and lists newest-first", async () => {
    const store = new FeedStore(new MemoryStorage());
    await store.init();
    expect(await store.upsert(item("01A"))).toBe(true);
    expect(await store.upsert(item("01C"))).toBe(true);
    expect(await store.upsert(item("01B"))).toBe(true);
    expect(await store.upsert(item("01B"))).toBe(false);
    expect(store.list().map((i) => i.id)).toEqual(["01C", "01B", "01A"]);
  });

  it("survives a restart via storage (the popup-instant-render path)", async () => {
    const storage = new MemoryStorage();
    const a = new FeedStore(storage);
    await a.init();
    await a.upsert(item("01A"));
    const b = new FeedStore(storage);
    await b.init();
    expect(b.list().map((i) => i.id)).toEqual(["01A"]);
  });

  it("tombstone wins: removed ids cannot be re-upserted (late WS echo)", async () => {
    const store = new FeedStore(new MemoryStorage());
    await store.init();
    await store.upsert(item("01A"));
    expect(await store.remove("01A")).toBe(true);
    expect(await store.remove("01A")).toBe(false);
    expect(await store.upsert(item("01A"))).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("caps at MAX_ITEMS, dropping the oldest", async () => {
    const store = new FeedStore(new MemoryStorage());
    await store.init();
    for (let i = 0; i < MAX_ITEMS + 5; i++) {
      await store.upsert(item(`01${String(i).padStart(6, "0")}`));
    }
    expect(store.list()).toHaveLength(MAX_ITEMS);
    expect(store.list().at(-1)!.id).toBe("01000005");
  });
});
```

`clients/extension/tests/messages.test.ts` (the contract tests from extension spec §9):

```ts
import { describe, expect, it } from "vitest";
import { isPopupRequest, isWorkerEvent } from "../src/shared/messages";

describe("popup→worker message guard", () => {
  it("accepts every request shape", () => {
    const good = [
      { type: "get_state" },
      { type: "refresh" },
      { type: "send", kind: "text", body: "x", targetDeviceId: null },
      { type: "send", kind: "link", body: "https://x", targetDeviceId: "d2" },
      { type: "retry", outboxId: "01X" },
      { type: "delete_item", itemId: "01X" },
      { type: "rename_device", deviceId: "d", name: "n" },
      { type: "revoke_device", deviceId: "d" },
      { type: "sign_out" },
    ];
    for (const msg of good) expect(isPopupRequest(msg)).toBe(true);
  });
  it("rejects malformed shapes", () => {
    const bad = [
      null,
      "get_state",
      { type: "unknown" },
      { type: "send", kind: "blob", body: "x", targetDeviceId: null },
      { type: "send", kind: "text" }, // missing body
      { type: "retry" },
      { type: "rename_device", deviceId: "d" },
    ];
    for (const msg of bad) expect(isPopupRequest(msg)).toBe(false);
  });
});

describe("worker→popup event guard", () => {
  it("accepts every event shape and rejects junk", () => {
    expect(isWorkerEvent({ type: "status", status: "live" })).toBe(true);
    expect(isWorkerEvent({ type: "item_deleted", itemId: "01X" })).toBe(true);
    expect(isWorkerEvent({ type: "auth_required" })).toBe(true);
    expect(isWorkerEvent({ type: "status" })).toBe(false);
    expect(isWorkerEvent({ type: "nope" })).toBe(false);
  });
});
```

`clients/extension/tests/settingsStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { setFakeBrowser } from "./polyfillMock";
import { makeFakeBrowser } from "./fakeBrowser";

describe("settings store", () => {
  beforeEach(() => {
    setFakeBrowser(makeFakeBrowser().browser);
    localStorage.clear();
  });

  it("auth round-trips and clears", async () => {
    const { loadAuth, saveAuth, clearAuth } = await import("../src/shared/settings");
    expect(await loadAuth()).toBeNull();
    const auth = { baseUrl: "http://s", token: "t", deviceId: "d", deviceName: "n" };
    await saveAuth(auth);
    expect(await loadAuth()).toEqual(auth);
    await clearAuth();
    expect(await loadAuth()).toBeNull();
  });

  it("prefs default and merge patches", async () => {
    const { DEFAULT_PREFS, loadPrefs, savePrefs } = await import("../src/shared/settings");
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
    await savePrefs({ notifyOnNewItems: true });
    expect(await loadPrefs()).toEqual({ notifyOnNewItems: true, contextMenuSend: true });
  });

  it("saveAppearance mirrors to localStorage for pre-paint reads", async () => {
    const { saveAppearance } = await import("../src/shared/settings");
    await saveAppearance({ theme: "dark", accent: "#2563eb" });
    expect(JSON.parse(localStorage.getItem("cc.appearance")!)).toEqual({
      theme: "dark",
      accent: "#2563eb",
    });
  });
});
```

- [ ] **Step 2: Build the fake browser, run tests to verify they fail**

`clients/extension/tests/fakeBrowser.ts`:

```ts
type Listener = (...args: unknown[]) => unknown;

function makeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    emit: (...args: unknown[]) => [...listeners].map((fn) => fn(...args)),
  };
}

export interface FakePort {
  name: string;
  onMessage: ReturnType<typeof makeEvent>;
  onDisconnect: ReturnType<typeof makeEvent>;
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  sent: unknown[];
}

export function makeFakeBrowser() {
  const storageData: Record<string, unknown> = {};
  const storageChanged = makeEvent();
  const onMessage = makeEvent();
  const onConnect = makeEvent();
  const calls = {
    notifications: [] as unknown[],
    badgeTexts: [] as string[],
    contextMenus: [] as unknown[],
    removedAllMenus: 0,
    tabs: [] as unknown[],
    windows: [] as unknown[],
    alarms: [] as unknown[],
  };

  const browser = {
    storage: {
      local: {
        get: async (keys?: string | string[]) => {
          if (keys === undefined) return { ...storageData };
          const list = typeof keys === "string" ? [keys] : keys;
          return Object.fromEntries(list.filter((k) => k in storageData).map((k) => [k, storageData[k]]));
        },
        set: async (values: Record<string, unknown>) => {
          Object.assign(storageData, values);
          storageChanged.emit(values, "local");
        },
        remove: async (keys: string | string[]) => {
          for (const k of typeof keys === "string" ? [keys] : keys) delete storageData[k];
        },
      },
      onChanged: storageChanged,
    },
    runtime: {
      onMessage,
      onConnect,
      sendMessage: async (msg: unknown) => {
        const results = onMessage.emit(msg, {});
        return Promise.resolve(results.find((r) => r !== undefined));
      },
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      getURL: (p: string) => `chrome-extension://fake/${p}`,
    },
    alarms: {
      create: (name: string, info: unknown) => calls.alarms.push({ name, info }),
      onAlarm: makeEvent(),
    },
    notifications: {
      create: async (id: string, opts: unknown) => (calls.notifications.push({ id, opts }), id),
      onClicked: makeEvent(),
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => void calls.badgeTexts.push(text),
      setBadgeBackgroundColor: async () => undefined,
      openPopup: async () => undefined,
    },
    contextMenus: {
      create: (opts: unknown) => calls.contextMenus.push(opts),
      removeAll: async () => void calls.removedAllMenus++,
      onClicked: makeEvent(),
    },
    permissions: { request: async () => true, contains: async () => true },
    tabs: { create: async (opts: unknown) => void calls.tabs.push(opts) },
    windows: { create: async (opts: unknown) => void calls.windows.push(opts) },
  };

  const makePort = (name: string): FakePort => {
    const port: FakePort = {
      name,
      onMessage: makeEvent(),
      onDisconnect: makeEvent(),
      sent: [],
      postMessage: (msg) => port.sent.push(msg),
      disconnect: () => port.onDisconnect.emit(),
    };
    return port;
  };

  return { browser, storageData, calls, makePort };
}
```

Run: `npm run test --workspace @crossclipper/extension`
Expected: the three new test files FAIL — source modules missing.

- [ ] **Step 3: Implement the four modules**

`clients/extension/src/shared/storage.ts`:

```ts
import browser from "webextension-polyfill";
import type { SyncStorage } from "@crossclipper/core";

type Area = {
  get(k: string | string[]): Promise<Record<string, unknown>>;
  set(v: Record<string, unknown>): Promise<void>;
};

/** browser.storage.local as core's SyncStorage — the worker's persistence
 *  for cursor (cc.cursor), outbox (cc.outbox) and the feed store (cc.items). */
export class ExtensionStorage implements SyncStorage {
  constructor(private readonly area: Area = browser.storage.local as unknown as Area) {}

  async get(key: string): Promise<string | null> {
    const res = await this.area.get(key);
    const v = res[key];
    return typeof v === "string" ? v : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.area.set({ [key]: value });
  }
}
```

`clients/extension/src/shared/settings.ts`:

```ts
import browser from "webextension-polyfill";
import {
  APPEARANCE_MIRROR_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  type Appearance,
} from "../theme/theme";

export interface AuthState {
  baseUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
}

export interface Prefs {
  notifyOnNewItems: boolean; // system spec §4: default OFF
  contextMenuSend: boolean;
}

export const DEFAULT_PREFS: Prefs = { notifyOnNewItems: false, contextMenuSend: true };

export const AUTH_KEY = "cc.auth";
export const PREFS_KEY = "cc.prefs";
export const APPEARANCE_KEY = "cc.appearanceStored";
export const SERVER_VERSION_KEY = "cc.serverVersion";

async function readJson<T>(key: string): Promise<T | null> {
  const res = await browser.storage.local.get(key);
  const raw = res[key];
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: JSON.stringify(value) });
}

export const loadAuth = (): Promise<AuthState | null> => readJson<AuthState>(AUTH_KEY);
export const saveAuth = (a: AuthState): Promise<void> => writeJson(AUTH_KEY, a);
export const clearAuth = (): Promise<void> => browser.storage.local.remove(AUTH_KEY);

export async function loadPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...((await readJson<Partial<Prefs>>(PREFS_KEY)) ?? {}) };
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await loadPrefs()), ...patch };
  await writeJson(PREFS_KEY, next);
  return next;
}

export async function loadAppearanceStored(): Promise<Appearance> {
  return { ...DEFAULT_APPEARANCE, ...((await readJson<Partial<Appearance>>(APPEARANCE_KEY)) ?? {}) };
}

/** Persist + mirror (pre-paint sync read) + apply immediately. */
export async function saveAppearance(a: Appearance): Promise<void> {
  await writeJson(APPEARANCE_KEY, a);
  try {
    localStorage.setItem(APPEARANCE_MIRROR_KEY, JSON.stringify(a));
  } catch {
    /* worker context has no localStorage — popup refreshes its mirror on load */
  }
  if (typeof document !== "undefined") applyAppearance(a);
}
```

`clients/extension/src/shared/messages.ts`:

```ts
import browser from "webextension-polyfill";
import type { Device, Item, SyncStatus } from "@crossclipper/core";

export const EVENTS_PORT = "cc-events";

export interface PendingSend {
  id: string;
  kind: "text" | "link";
  body: string;
  targetDeviceId: string | null;
  failed: boolean;
  errorMessage?: string;
}

export interface StateSnapshot {
  authed: boolean;
  baseUrl: string | null;
  deviceId: string | null;
  status: SyncStatus;
  items: Item[];
  pending: PendingSend[];
  devices: Device[];
}

export type PopupRequest =
  | { type: "get_state" }
  | { type: "refresh" }
  | { type: "send"; kind: "text" | "link"; body: string; targetDeviceId: string | null }
  | { type: "retry"; outboxId: string }
  | { type: "delete_item"; itemId: string }
  | { type: "rename_device"; deviceId: string; name: string }
  | { type: "revoke_device"; deviceId: string }
  | { type: "sign_out" };

export type WorkerEvent =
  | { type: "snapshot"; state: StateSnapshot }
  | { type: "item"; item: Item }
  | { type: "item_deleted"; itemId: string }
  | { type: "status"; status: SyncStatus }
  | { type: "outbox_changed"; pending: PendingSend[] }
  | { type: "devices"; devices: Device[] }
  | { type: "auth_required" };

const isStr = (v: unknown): v is string => typeof v === "string";
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isPopupRequest(v: unknown): v is PopupRequest {
  if (!rec(v) || !isStr(v.type)) return false;
  switch (v.type) {
    case "get_state":
    case "refresh":
    case "sign_out":
      return true;
    case "send":
      return (
        (v.kind === "text" || v.kind === "link") &&
        isStr(v.body) &&
        (v.targetDeviceId === null || isStr(v.targetDeviceId))
      );
    case "retry":
      return isStr(v.outboxId);
    case "delete_item":
      return isStr(v.itemId);
    case "rename_device":
      return isStr(v.deviceId) && isStr(v.name);
    case "revoke_device":
      return isStr(v.deviceId);
    default:
      return false;
  }
}

export function isWorkerEvent(v: unknown): v is WorkerEvent {
  if (!rec(v) || !isStr(v.type)) return false;
  switch (v.type) {
    case "snapshot":
      return rec(v.state);
    case "item":
      return rec(v.item);
    case "item_deleted":
      return isStr(v.itemId);
    case "status":
      return isStr(v.status);
    case "outbox_changed":
      return Array.isArray(v.pending);
    case "devices":
      return Array.isArray(v.devices);
    case "auth_required":
      return true;
    default:
      return false;
  }
}

/** Popup-side RPC. Worker replies via the onMessage return value. */
export async function requestWorker<T = unknown>(req: PopupRequest): Promise<T> {
  return (await browser.runtime.sendMessage(req)) as T;
}
```

`clients/extension/src/background/feedStore.ts`:

```ts
import type { Item, SyncStorage } from "@crossclipper/core";

const ITEMS_KEY = "cc.items";
const TOMBSTONES_KEY = "cc.itemTombstones";
export const MAX_ITEMS = 1000;

/** Extension-side persisted feed. Core's ItemCache is in-memory and cursor
 *  pulls only return NEW items after a worker restart — this store is what
 *  makes the popup render instantly from cache (extension spec §6).
 *  Persistence glue only: live dedup/ordering authority stays in core. */
export class FeedStore {
  private items: Item[] = []; // newest-first (ULID desc)
  private tombstones = new Set<string>();

  constructor(private readonly storage: SyncStorage) {}

  async init(): Promise<void> {
    try {
      this.items = JSON.parse((await this.storage.get(ITEMS_KEY)) ?? "[]") as Item[];
      this.tombstones = new Set(
        JSON.parse((await this.storage.get(TOMBSTONES_KEY)) ?? "[]") as string[],
      );
    } catch {
      this.items = [];
      this.tombstones = new Set();
    }
  }

  async upsert(item: Item): Promise<boolean> {
    if (this.tombstones.has(item.id)) return false;
    if (this.items.some((i) => i.id === item.id)) return false;
    this.items.push(item);
    this.items.sort((a, b) => (a.id > b.id ? -1 : 1));
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    await this.persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (this.tombstones.has(id)) return false;
    this.tombstones.add(id);
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    return before !== this.items.length || true;
  }

  list(): Item[] {
    return [...this.items];
  }

  async clear(): Promise<void> {
    this.items = [];
    this.tombstones = new Set();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.storage.set(ITEMS_KEY, JSON.stringify(this.items));
    await this.storage.set(TOMBSTONES_KEY, JSON.stringify([...this.tombstones]));
  }
}
```

(Note the `remove` return: it must be `true` the first time an id is tombstoned — even if the item wasn't cached — and `false` on repeats; the expression above returns `true` on first tombstone regardless of cache presence. Simplify to exactly that:)

```ts
  async remove(id: string): Promise<boolean> {
    if (this.tombstones.has(id)) return false;
    this.tombstones.add(id);
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    return true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): shared storage, settings, messaging contract and feed store"
```

## Task 13: BackgroundController + worker entry

**Files:**
- Create: `clients/extension/src/background/socket.ts`
- Create: `clients/extension/src/background/controller.ts`
- Modify: `clients/extension/src/background/index.ts` (replace placeholder)
- Test: `clients/extension/tests/controller.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `SyncEngine`, `Outbox`, `SyncStorage`, `SocketFactory`, `WsLike`, `ApiError`, `OutboxEntry`, `Item`, `Device` from `@crossclipper/core`; Task 12 modules.
- Produces:
  - `socket.ts`: `browserSocketFactory: SocketFactory` (native `WebSocket` → `WsLike`); `wsUrl(baseUrl: string, token: string): string` → `ws(s)://…/api/v1/ws?token=…`.
  - `controller.ts`:
    ```ts
    export const CLIENT_VERSION = "0.1.0";
    export interface ControllerDeps {
      storage: SyncStorage;
      socketFactory: SocketFactory;
      fetchFn?: typeof fetch;
      onNewItem?: (item: Item) => void;   // alert hook, wired in Task 18
    }
    export class BackgroundController {
      constructor(deps: ControllerDeps);
      wake(): Promise<void>;                        // idempotent boot: load auth → build client/engine/outbox → start + flush
      handleRequest(req: PopupRequest): Promise<unknown>;
      onPortConnect(port: { name: string; postMessage(m: unknown): void; onDisconnect: { addListener(fn: () => void): void } }): Promise<void>;
      onPopupOpened?: () => void;                   // badge-clear hook, wired in Task 18
      snapshot(): Promise<StateSnapshot>;
    }
    ```
  - `index.ts`: MV3 glue — every wake path (`module eval`, `onInstalled`, `onStartup`, `onAlarm "cc-tick"` every 1 min, popup message/connect) funnels into `controller.wake()`; `runtime.onMessage` guards with `isPopupRequest` and returns `handleRequest`'s promise; `runtime.onConnect` for `EVENTS_PORT`.

Behavioral contract (encoded in the tests below):
- No auth in storage → `wake()` is a no-op; `get_state` snapshot has `authed: false`.
- With auth: engine events fan out — `item` → `FeedStore.upsert`; only NEW ids broadcast `{type:"item"}` + call `onNewItem`; `item_deleted` → `FeedStore.remove` + broadcast; `status` → broadcast; `devices_changed` → re-fetch device list, cache under `cc.devices`, broadcast `{type:"devices"}`.
- Outbox events: `delivered` → FeedStore.upsert + broadcast item + `outbox_changed`; `rejected` → entry kept in a `failed` map (rendered as "not sent — tap to retry") + `outbox_changed`; `auth_required` → broadcast `auth_required`.
- `send` → `outbox.send(kind, body, targetDeviceId ?? undefined)` → broadcast `outbox_changed` → returns `{ outboxId }`.
- `retry` → drop from failed map, re-send same kind/body/target (new ULID).
- `delete_item` → `client.deleteItem` then FeedStore.remove + broadcast (idempotent with the WS echo).
- `sign_out` → stop engine + outbox, `clearAuth`, `FeedStore.clear`, clear `cc.cursor`/`cc.outbox`/`cc.devices`, broadcast fresh snapshot.
- `onPortConnect` → push `{type:"snapshot"}` immediately (popup renders instantly from cache), call `onPopupOpened`, trigger a background `wake()` + engine refresh.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/controller.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import { setFakeBrowser } from "./polyfillMock";
import { makeFakeBrowser, type FakePort } from "./fakeBrowser";

// FakeSocket implementing core's WsLike, driven by tests.
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
  open() {
    this.onopen?.();
  }
  push(ev: unknown) {
    this.onmessage?.(JSON.stringify(ev));
  }
}

const AUTH = JSON.stringify({ baseUrl: "http://s", token: "tok", deviceId: "self", deviceName: "me" });

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, kind: "text", body: id, origin_device_id: "d2", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null, ...over }) as Item;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** Minimal fake server: items page + create + devices. */
function makeFetch(pages: Item[][]) {
  const created: Record<string, unknown>[] = [];
  let page = 0;
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/items") && (!init || init.method === undefined || init.method === "GET")) {
      const items = pages[Math.min(page, pages.length - 1)] ?? [];
      page++;
      return jsonResponse({ items, next_cursor: null });
    }
    if (u.includes("/items") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created.push(body);
      return jsonResponse(item(body.id as string, { body: body.body as string, origin_device_id: "self" }), 201);
    }
    if (u.includes("/devices")) return jsonResponse({ devices: [{ id: "self", name: "me", platform: "extension", online: true, last_seen_at: "2026-07-03T00:00:00", created_at: "2026-07-01T00:00:00" }] });
    if (u.endsWith(`/items/01DEL`)) return new Response(null, { status: 204 });
    return jsonResponse({ code: "not_found", message: u }, 404);
  }) as typeof fetch;
  return { fetchFn, created };
}

async function makeController(storageSeed: Record<string, string>, pages: Item[][] = [[]]) {
  FakeSocket.instances = [];
  const fake = makeFakeBrowser();
  setFakeBrowser(fake.browser);
  const storage = new MemoryStorage();
  for (const [k, v] of Object.entries(storageSeed)) await storage.set(k, v);
  const { fetchFn, created } = makeFetch(pages);
  const onNewItem = vi.fn();
  const { BackgroundController } = await import("../src/background/controller");
  const controller = new BackgroundController({
    storage,
    socketFactory: (url) => new FakeSocket(url) as never,
    fetchFn,
    onNewItem,
  });
  return { controller, created, onNewItem, fake, storage };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BackgroundController", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("without auth, wake is a no-op and the snapshot says unauthenticated", async () => {
    const { controller } = await makeController({});
    await controller.wake();
    expect(FakeSocket.instances).toHaveLength(0);
    const snap = await controller.snapshot();
    expect(snap.authed).toBe(false);
  });

  it("with auth, wake starts the engine against the ws url with the token", async () => {
    const { controller } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    expect(FakeSocket.instances[0]!.url).toBe("ws://s/api/v1/ws?token=tok");
  });

  it("pulled items land in the persisted feed and fire the new-item hook once", async () => {
    const { controller, onNewItem } = await makeController({ "cc.auth": AUTH }, [[item("01A")]]);
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    const snap = await controller.snapshot();
    expect(snap.items.map((i) => i.id)).toEqual(["01A"]);
    expect(onNewItem).toHaveBeenCalledTimes(1);
    // duplicate delivery (WS echo after pull) does not re-fire
    FakeSocket.instances[0]!.push({ type: "item_new", item: item("01A") });
    await flush();
    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it("send goes through the outbox with the target and answers the outbox id", async () => {
    const { controller, created } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const res = (await controller.handleRequest({
      type: "send",
      kind: "text",
      body: "hello",
      targetDeviceId: "d2",
    })) as { outboxId: string };
    await flush();
    expect(res.outboxId).toBeTruthy();
    expect(created[0]).toMatchObject({ body: "hello", target_device_id: "d2" });
  });

  it("port connect pushes a snapshot event immediately", async () => {
    const { controller, fake } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const port = fake.makePort("cc-events") as FakePort;
    await controller.onPortConnect(port as never);
    expect(port.sent[0]).toMatchObject({ type: "snapshot", state: { authed: true } });
  });

  it("live WS events broadcast to connected ports", async () => {
    const { controller, fake } = await makeController({ "cc.auth": AUTH });
    await controller.wake();
    const port = fake.makePort("cc-events") as FakePort;
    await controller.onPortConnect(port as never);
    FakeSocket.instances[0]!.open();
    await flush();
    FakeSocket.instances[0]!.push({ type: "item_new", item: item("01B") });
    await flush();
    expect(port.sent.some((m) => (m as { type: string }).type === "item")).toBe(true);
  });

  it("sign_out wipes auth, feed, cursor and outbox and reports unauthenticated", async () => {
    const { controller, storage } = await makeController({ "cc.auth": AUTH }, [[item("01A")]]);
    await controller.wake();
    FakeSocket.instances[0]!.open();
    await flush();
    await controller.handleRequest({ type: "sign_out" });
    expect((await controller.snapshot()).authed).toBe(false);
    expect(await storage.get("cc.cursor")).toBeNull();
    expect(JSON.parse((await storage.get("cc.items")) ?? "[]")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — `../src/background/controller` not found.

- [ ] **Step 3: Implement socket adapter, controller, worker entry**

`clients/extension/src/background/socket.ts`:

```ts
import type { SocketFactory, WsLike } from "@crossclipper/core";

export function wsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

export const browserSocketFactory: SocketFactory = (url: string): WsLike => {
  const ws = new WebSocket(url);
  const like: WsLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => like.onopen?.();
  ws.onmessage = (ev) => like.onmessage?.(String(ev.data));
  ws.onclose = () => like.onclose?.();
  return like;
};
```

`clients/extension/src/background/controller.ts`:

```ts
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
import { clearAuth, loadAuth, type AuthState } from "../shared/settings";
import type { PendingSend, PopupRequest, StateSnapshot, WorkerEvent } from "../shared/messages";
import { FeedStore } from "./feedStore";
import { wsUrl } from "./socket";

export const CLIENT_VERSION = "0.1.0";
const DEVICES_KEY = "cc.devices";

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
    this.auth = await loadAuth();
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
      | { type: "status"; status: SyncStatus },
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
        await clearAuth();
        await this.feed.clear();
        await this.deps.storage.set("cc.cursor", "");
        await this.deps.storage.set("cc.outbox", "[]");
        await this.deps.storage.set(DEVICES_KEY, "[]");
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
```

Note on `sign_out` + cursor: core's `SyncStorage` has no `remove`; writing `""`/`"[]"` is the reset convention (an empty cursor string is falsy in the engine's `storage.get` handling — verify against merged core: if the engine treats `""` as a real cursor, add a guard or store-key wipe via `browser.storage.local.remove` in `ExtensionStorage`-specific code instead. The test in Step 1 pins the observable behavior — items wiped, snapshot unauthenticated).

`clients/extension/src/background/index.ts`:

```ts
import browser from "webextension-polyfill";
import { EVENTS_PORT, isPopupRequest } from "../shared/messages";
import { ExtensionStorage } from "../shared/storage";
import { BackgroundController } from "./controller";
import { browserSocketFactory } from "./socket";

const controller = new BackgroundController({
  storage: new ExtensionStorage(),
  socketFactory: browserSocketFactory,
});

// RPC: popup requests, promise-based replies.
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (isPopupRequest(msg)) return controller.handleRequest(msg);
  return undefined;
});

// Events: long-lived port per open popup.
browser.runtime.onConnect.addListener((port) => {
  if (port.name === EVENTS_PORT) void controller.onPortConnect(port);
});

// Wake paths (MV3: any of these may be the first code to run after an idle kill).
browser.runtime.onInstalled.addListener(() => {
  void browser.alarms.create("cc-tick", { periodInMinutes: 1 });
  void controller.wake();
});
browser.runtime.onStartup.addListener(() => void controller.wake());
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cc-tick") void controller.wake();
});
void controller.wake();

export { controller }; // consumed by alerts/menus wiring (Tasks 18–19)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension && npm run build --workspace @crossclipper/extension`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): background worker hosting the core sync engine and outbox"
```

### PR 6 checkpoint

- [ ] Extension suite + typecheck + build green; core suite still green.
- [ ] **STOP — Diego review**, then push + PR `feat(extension): background worker owning the core sync engine`.

---
# PR 7 — Wire the popup to the live worker

**Needs:** PR 6 merged.

## Task 14: `useWorker` hook (port + reducer)

**Files:**
- Create: `clients/extension/src/popup/useWorker.ts`
- Test: `clients/extension/tests/useWorker.test.tsx`

**Interfaces:**
- Consumes: `EVENTS_PORT`, `WorkerEvent`, `StateSnapshot`, `PendingSend`, `requestWorker`, `isWorkerEvent` (Task 12); `FeedEntry` (Task 7).
- Produces:
  ```ts
  export interface PopupState {
    ready: boolean;            // first snapshot received
    authed: boolean;
    authRequired: boolean;     // 401 → App routes to onboarding step 2
    baseUrl: string | null;
    deviceId: string | null;
    status: SyncStatus;
    items: Item[];             // newest-first, deduped
    pending: PendingSend[];
    devices: Device[];
  }
  export interface WorkerApi {
    send(kind: "text" | "link", body: string, targetDeviceId: string | null): Promise<void>;
    retry(outboxId: string): Promise<void>;
    deleteItem(itemId: string): Promise<void>;
    refresh(): Promise<void>;
    renameDevice(deviceId: string, name: string): Promise<void>;
    revokeDevice(deviceId: string): Promise<void>;
    signOut(): Promise<void>;
  }
  export function reduce(state: PopupState, event: WorkerEvent): PopupState;  // exported for tests
  export function useWorker(): { state: PopupState; api: WorkerApi };
  ```
- Reducer rules: `snapshot` replaces everything and sets `ready/authed`; `item` inserts by ULID desc if unseen; `item_deleted` filters; `status` updates; `outbox_changed` replaces `pending`; `devices` replaces `devices`; `auth_required` sets `authRequired: true`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/useWorker.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Item } from "@crossclipper/core";
import { makeFakeBrowser, type FakePort } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";

const item = (id: string): Item =>
  ({ id, kind: "text", body: id, origin_device_id: "d2", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null }) as Item;

const snapshot = {
  authed: true,
  baseUrl: "http://s",
  deviceId: "self",
  status: "live",
  items: [item("01B"), item("01A")],
  pending: [],
  devices: [],
};

describe("reduce", () => {
  it("inserts live items in ULID order without duplicates", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "item", item: item("01C") });
    s = reduce(s, { type: "item", item: item("01C") });
    expect(s.items.map((i) => i.id)).toEqual(["01C", "01B", "01A"]);
    s = reduce(s, { type: "item_deleted", itemId: "01B" });
    expect(s.items.map((i) => i.id)).toEqual(["01C", "01A"]);
  });
  it("auth_required flips the flag", async () => {
    const { reduce } = await import("../src/popup/useWorker");
    let s = reduce(undefined as never, { type: "snapshot", state: snapshot as never });
    s = reduce(s, { type: "auth_required" });
    expect(s.authRequired).toBe(true);
  });
});

describe("useWorker", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  let connectedPort: FakePort | null = null;

  beforeEach(() => {
    fake = makeFakeBrowser();
    connectedPort = null;
    // popup side calls browser.runtime.connect — extend the fake for this test
    (fake.browser.runtime as Record<string, unknown>).connect = ({ name }: { name: string }) => {
      connectedPort = fake.makePort(name);
      return connectedPort;
    };
    setFakeBrowser(fake.browser);
  });

  it("connects the events port and applies pushed snapshots", async () => {
    const { useWorker } = await import("../src/popup/useWorker");
    const { result } = renderHook(() => useWorker());
    expect(result.current.state.ready).toBe(false);
    act(() => {
      connectedPort!.onMessage.emit({ type: "snapshot", state: snapshot });
    });
    expect(result.current.state.ready).toBe(true);
    expect(result.current.state.items).toHaveLength(2);
  });

  it("api.send RPCs the worker with the target", async () => {
    const seen: unknown[] = [];
    fake.browser.runtime.onMessage.addListener((msg: unknown) => {
      seen.push(msg);
      return Promise.resolve({ outboxId: "01X" });
    });
    const { useWorker } = await import("../src/popup/useWorker");
    const { result } = renderHook(() => useWorker());
    await act(() => result.current.api.send("text", "hi", "d2"));
    expect(seen[0]).toEqual({ type: "send", kind: "text", body: "hi", targetDeviceId: "d2" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — `../src/popup/useWorker` not found.

- [ ] **Step 3: Implement**

`clients/extension/src/popup/useWorker.ts`:

```ts
import { useEffect, useMemo, useReducer } from "react";
import browser from "webextension-polyfill";
import type { Device, Item, SyncStatus } from "@crossclipper/core";
import {
  EVENTS_PORT,
  isWorkerEvent,
  requestWorker,
  type PendingSend,
  type WorkerEvent,
} from "../shared/messages";

export interface PopupState {
  ready: boolean;
  authed: boolean;
  authRequired: boolean;
  baseUrl: string | null;
  deviceId: string | null;
  status: SyncStatus;
  items: Item[];
  pending: PendingSend[];
  devices: Device[];
}

export const INITIAL_STATE: PopupState = {
  ready: false,
  authed: false,
  authRequired: false,
  baseUrl: null,
  deviceId: null,
  status: "stopped",
  items: [],
  pending: [],
  devices: [],
};

function insertDesc(items: Item[], item: Item): Item[] {
  if (items.some((i) => i.id === item.id)) return items;
  return [...items, item].sort((a, b) => (a.id > b.id ? -1 : 1));
}

export function reduce(state: PopupState | undefined, event: WorkerEvent): PopupState {
  const s = state ?? INITIAL_STATE;
  switch (event.type) {
    case "snapshot":
      return { ...s, ...event.state, ready: true };
    case "item":
      return { ...s, items: insertDesc(s.items, event.item) };
    case "item_deleted":
      return { ...s, items: s.items.filter((i) => i.id !== event.itemId) };
    case "status":
      return { ...s, status: event.status };
    case "outbox_changed":
      return { ...s, pending: event.pending };
    case "devices":
      return { ...s, devices: event.devices };
    case "auth_required":
      return { ...s, authRequired: true };
    default:
      return s;
  }
}

export interface WorkerApi {
  send(kind: "text" | "link", body: string, targetDeviceId: string | null): Promise<void>;
  retry(outboxId: string): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  refresh(): Promise<void>;
  renameDevice(deviceId: string, name: string): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;
  signOut(): Promise<void>;
}

export function useWorker(): { state: PopupState; api: WorkerApi } {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);

  useEffect(() => {
    const port = browser.runtime.connect({ name: EVENTS_PORT });
    const onMessage = (msg: unknown) => {
      if (isWorkerEvent(msg)) dispatch(msg);
    };
    port.onMessage.addListener(onMessage);
    return () => {
      port.onMessage.removeListener(onMessage);
      port.disconnect();
    };
  }, []);

  const api = useMemo<WorkerApi>(
    () => ({
      send: async (kind, body, targetDeviceId) => {
        await requestWorker({ type: "send", kind, body, targetDeviceId });
      },
      retry: async (outboxId) => {
        await requestWorker({ type: "retry", outboxId });
      },
      deleteItem: async (itemId) => {
        await requestWorker({ type: "delete_item", itemId });
      },
      refresh: async () => {
        await requestWorker({ type: "refresh" });
      },
      renameDevice: async (deviceId, name) => {
        await requestWorker({ type: "rename_device", deviceId, name });
      },
      revokeDevice: async (deviceId) => {
        await requestWorker({ type: "revoke_device", deviceId });
      },
      signOut: async () => {
        await requestWorker({ type: "sign_out" });
      },
    }),
    [],
  );

  return { state, api };
}
```

Also extend `tests/fakeBrowser.ts`'s `browser.runtime` with a default `connect` so other tests don't crash:

```ts
      connect: ({ name }: { name: string }) => makePortInternal(name),
```

(factor `makePort` so both the returned helper and `runtime.connect` share it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): useWorker hook bridging the popup to worker state"
```

## Task 15: Live App — feed, compose, retry, presence, banner, new-items pill

**Files:**
- Create: `clients/extension/src/popup/components/Feed.tsx`
- Modify: `clients/extension/src/popup/App.tsx` (fixtures → live state; same JSX skeleton)
- Test: `clients/extension/tests/appLive.test.tsx`
- Keep: `fixtures.ts` (still used by tests as canned worker snapshots)

**Interfaces:**
- Consumes: `useWorker` (Task 14), all Task 7–9 components.
- Produces:
  - `Feed({ entries: FeedEntry[]; nameOf(id: string): string; iconOf(id: string): string; onCopy; onOpen; onDelete; onRetry })` — renders the scrollable card list, the empty-state hint, and the "↑ new items" pill: while the container's `scrollTop > 40`, newly arriving entries increment a counter instead of moving the view; clicking the pill scrolls to top and clears it.
  - `App` — routes on worker state (this task: loading splash / main; Tasks 17/20 add onboarding and settings routes); merges `state.pending` into feed entries (`sendState: failed ? "failed" : "pending"`, rendered above synced items); rail devices from `state.devices` via `toDeviceView(d, state.deviceId)`; disconnected banner when `authed && status !== "live"`; copy → `navigator.clipboard.writeText`; open → `browser.tabs.create({ url })`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/appLive.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { makeFakeBrowser, type FakePort } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, kind: "text", body: `body ${id}`, origin_device_id: "d2", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null, ...over }) as Item;

const devices = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, last_seen_at: "2026-07-03T11:59:30", created_at: "2026-07-01T00:00:00" },
  { id: "d2", name: "Pixel 8", platform: "android", online: true, last_seen_at: "2026-07-03T11:59:00", created_at: "2026-07-01T00:00:00" },
];

const liveSnapshot = (over: Record<string, unknown> = {}) => ({
  authed: true,
  baseUrl: "http://s",
  deviceId: "self",
  status: "live",
  items: [item("01B"), item("01A")],
  pending: [],
  devices,
  ...over,
});

describe("App (live)", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  let port: FakePort | null;
  let rpcs: unknown[];

  beforeEach(() => {
    fake = makeFakeBrowser();
    port = null;
    rpcs = [];
    (fake.browser.runtime as Record<string, unknown>).connect = ({ name }: { name: string }) => {
      port = fake.makePort(name);
      return port;
    };
    fake.browser.runtime.onMessage.addListener((msg: unknown) => {
      rpcs.push(msg);
      return Promise.resolve({ ok: true, outboxId: "01X" });
    });
    setFakeBrowser(fake.browser);
  });

  async function renderLive(snapshot = liveSnapshot()) {
    const { default: App } = await import("../src/popup/App");
    render(<App />);
    act(() => {
      port!.onMessage.emit({ type: "snapshot", state: snapshot });
    });
  }

  it("renders synced items with resolved device names", async () => {
    await renderLive();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText(/Pixel 8/).length).toBeGreaterThan(0);
  });

  it("compose sends through the worker RPC", async () => {
    await renderLive();
    await userEvent.type(screen.getByRole("textbox"), "hello{Enter}");
    expect(rpcs).toContainEqual({ type: "send", kind: "text", body: "hello", targetDeviceId: null });
  });

  it("pending sends render as sending cards; failed ones offer retry", async () => {
    await renderLive(
      liveSnapshot({
        pending: [
          { id: "01P", kind: "text", body: "queued", targetDeviceId: null, failed: false },
          { id: "01F", kind: "text", body: "broken", targetDeviceId: null, failed: true },
        ],
      }),
    );
    expect(screen.getByText(/sending…/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /not sent — tap to retry/i }));
    expect(rpcs).toContainEqual({ type: "retry", outboxId: "01F" });
  });

  it("shows the reconnecting banner when not live", async () => {
    await renderLive(liveSnapshot({ status: "connecting" }));
    expect(screen.getByText(/reconnecting…/i)).toBeInTheDocument();
  });

  it("delete RPCs the worker", async () => {
    await renderLive();
    await userEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]!);
    expect(rpcs).toContainEqual({ type: "delete_item", itemId: "01B" });
  });

  it("live items arriving while scrolled show the new-items pill", async () => {
    await renderLive();
    const feed = document.querySelector(".feed")!;
    Object.defineProperty(feed, "scrollTop", { value: 200, writable: true });
    feed.dispatchEvent(new Event("scroll"));
    act(() => {
      port!.onMessage.emit({ type: "item", item: item("01C") });
    });
    expect(await screen.findByRole("button", { name: /new item/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — App still renders fixtures (no port, no RPC).

- [ ] **Step 3: Implement Feed and rewire App**

`clients/extension/src/popup/components/Feed.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { FeedCard, type FeedEntry } from "./FeedCard";

export interface FeedProps {
  entries: FeedEntry[];
  nameOf(id: string): string;
  iconOf(id: string): string;
  onCopy(body: string): void | Promise<void>;
  onOpen(url: string): void;
  onDelete(id: string): void;
  onRetry(id: string): void;
}

export function Feed({ entries, nameOf, iconOf, onCopy, onOpen, onDelete, onRetry }: FeedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const prevTopId = useRef<string | null>(null);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    const topId = entries[0]?.item.id ?? null;
    if (prevTopId.current !== null && topId !== null && topId !== prevTopId.current && scrolled.current) {
      setNewCount((n) => n + 1);
    }
    prevTopId.current = topId;
  }, [entries]);

  const onScroll = () => {
    scrolled.current = (ref.current?.scrollTop ?? 0) > 40;
    if (!scrolled.current) setNewCount(0);
  };

  return (
    <div className="feed" ref={ref} onScroll={onScroll}>
      {newCount > 0 && (
        <button
          className="pill"
          aria-label={`${newCount} new items`}
          onClick={() => {
            ref.current?.scrollTo({ top: 0 });
            setNewCount(0);
          }}
        >
          ↑ {newCount} new item{newCount > 1 ? "s" : ""}
        </button>
      )}
      {entries.length === 0 && (
        <p className="empty">Copy something on another device, or type below.</p>
      )}
      {entries.map((entry) => (
        <FeedCard
          key={entry.item.id}
          entry={entry}
          originName={nameOf(entry.item.origin_device_id)}
          originIcon={iconOf(entry.item.origin_device_id)}
          onCopy={onCopy}
          onOpen={onOpen}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}
```

`clients/extension/src/popup/App.tsx` (full replacement):

```tsx
import { useMemo, useState } from "react";
import browser from "webextension-polyfill";
import type { Item } from "@crossclipper/core";
import { Banner } from "./components/Banner";
import { Compose } from "./components/Compose";
import { DeviceRail } from "./components/DeviceRail";
import { Feed } from "./components/Feed";
import type { FeedEntry } from "./components/FeedCard";
import { platformIcon, toDeviceView } from "../shared/model";
import { useWorker } from "./useWorker";

export default function App() {
  const { state, api } = useWorker();
  const [filter, setFilter] = useState<string | null>(null);

  const deviceViews = useMemo(
    () => state.devices.map((d) => toDeviceView(d, state.deviceId)),
    [state.devices, state.deviceId],
  );

  const entries = useMemo<FeedEntry[]>(() => {
    const pendingEntries: FeedEntry[] = state.pending.map((p) => ({
      item: {
        id: p.id,
        kind: p.kind,
        body: p.body,
        origin_device_id: state.deviceId ?? "",
        target_device_id: p.targetDeviceId,
        blob_id: null,
        created_at: new Date().toISOString().slice(0, 19),
        deleted_at: null,
      } as Item,
      sendState: p.failed ? ("failed" as const) : ("pending" as const),
    }));
    const synced: FeedEntry[] = state.items.map((item) => ({ item }));
    const all = [...pendingEntries, ...synced];
    return filter ? all.filter((e) => e.item.origin_device_id === filter) : all;
  }, [state.pending, state.items, state.deviceId, filter]);

  const nameOf = (id: string) => deviceViews.find((d) => d.id === id)?.name ?? "Unknown device";
  const iconOf = (id: string) =>
    platformIcon(deviceViews.find((d) => d.id === id)?.platform ?? "");

  if (!state.ready) return <div className="app" />;

  return (
    <div className="app">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <button aria-label="Settings">⚙</button>
      </header>
      {state.authed && state.status !== "live" ? <Banner kind="reconnecting" /> : <div />}
      <div className="main">
        <DeviceRail devices={deviceViews} selected={filter} onSelect={setFilter} />
        <Feed
          entries={entries}
          nameOf={nameOf}
          iconOf={iconOf}
          onCopy={(body) => void navigator.clipboard.writeText(body)}
          onOpen={(url) => void browser.tabs.create({ url })}
          onDelete={(id) => void api.deleteItem(id)}
          onRetry={(id) => void api.retry(id)}
        />
      </div>
      <Compose
        devices={deviceViews}
        onSend={(kind, body, target) => void api.send(kind, body, target)}
      />
    </div>
  );
}
```

Update `clients/extension/tests/appStatic.test.tsx`: the shell is no longer fixture-driven — rewrite its cases to drive the same fake-port pattern as `appLive.test.tsx` (emit a snapshot built from `fixtures.ts`), keeping the rail-filter and empty-state assertions. If that makes it redundant with `appLive.test.tsx`, fold the surviving assertions into `appLive.test.tsx` and delete `appStatic.test.tsx` (note it in the commit message).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension && npm run build --workspace @crossclipper/extension`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): live popup wired to worker state with pill, banner and retries"
```

### PR 7 checkpoint

- [ ] Suite green. Manual smoke against a local server (`cd server && CC_SECRET_KEY=dev CC_DATA_DIR=/tmp/cc-dev uv run uvicorn crossclipper.asgi:app --port 8080`): temporarily seed auth via the worker console (`browser.storage.local.set`) — full onboarding lands in PR 8; verify items sync and compose sends.
- [ ] **STOP — Diego review**, then push + PR `feat(extension): wire popup to the live worker`.

---

# PR 8 — Onboarding

**Needs:** PR 7 merged.

## Task 16: Server step — URL validation, probe, permissions

**Files:**
- Create: `clients/extension/src/popup/onboarding/probe.ts`
- Create: `clients/extension/src/popup/onboarding/ServerStep.tsx`
- Test: `clients/extension/tests/probe.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `ApiError`, `NetworkError`, `HealthOut` from `@crossclipper/core`; `CLIENT_VERSION` (Task 13); `SERVER_VERSION_KEY` (Task 12).
- Produces:
  ```ts
  export const MIN_SERVER_VERSION = "0.1.0";
  export type ProbeResult =
    | { ok: true; version: string; registrationOpen: boolean }
    | { ok: false; reason: "unreachable" | "unhealthy" | "not_crossclipper" | "server_too_old" };
  export function normalizeServerUrl(input: string): string | null; // add https:// if schemeless, strip trailing "/", null if unparseable
  export function isInsecureHttp(url: string): boolean;             // http: AND not localhost/127.*/10.*/192.168.*/172.16-31.*/*.local
  export function semverGte(a: string, b: string): boolean;
  export function probeServer(baseUrl: string, fetchFn?: typeof fetch): Promise<ProbeResult>;
  ```
  - `ServerStep({ initialUrl?: string; onNext(baseUrl: string, probe: Extract<ProbeResult, { ok: true }>): void })` — URL input; on Next: normalize → request per-origin host permission (`browser.permissions.request({ origins: [origin + "/*"] })`, wrapped in try/catch since localhost is pre-granted and Firefox may throw on invalid patterns) → probe → render `✓ CrossClipper v{version} found` then advance, or the reason-specific error; shows the loud insecure-HTTP warning inline when `isInsecureHttp`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isInsecureHttp,
  normalizeServerUrl,
  probeServer,
  semverGte,
} from "../src/popup/onboarding/probe";

describe("normalizeServerUrl", () => {
  it("adds https:// to schemeless input and strips trailing slash", () => {
    expect(normalizeServerUrl("clip.example.com")).toBe("https://clip.example.com");
    expect(normalizeServerUrl("http://192.168.1.10:8080/")).toBe("http://192.168.1.10:8080");
    expect(normalizeServerUrl("not a url at all")).toBeNull();
  });
});

describe("isInsecureHttp", () => {
  it("flags public plain http, allows localhost and private ranges", () => {
    expect(isInsecureHttp("http://clip.example.com")).toBe(true);
    expect(isInsecureHttp("https://clip.example.com")).toBe(false);
    expect(isInsecureHttp("http://localhost:8080")).toBe(false);
    expect(isInsecureHttp("http://127.0.0.1:8080")).toBe(false);
    expect(isInsecureHttp("http://192.168.1.10:8080")).toBe(false);
    expect(isInsecureHttp("http://10.0.0.5")).toBe(false);
    expect(isInsecureHttp("http://nas.local:8080")).toBe(false);
  });
});

describe("semverGte", () => {
  it("compares numerically per segment", () => {
    expect(semverGte("0.2.0", "0.1.0")).toBe(true);
    expect(semverGte("0.1.0", "0.1.0")).toBe(true);
    expect(semverGte("0.0.9", "0.1.0")).toBe(false);
    expect(semverGte("1.0.0", "0.10.3")).toBe(true);
  });
});

describe("probeServer", () => {
  const healthOk = { status: "ok", app: "crossclipper", version: "0.1.0", registration_open: false };

  const fetchReturning = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("success carries version and registration state", async () => {
    const res = await probeServer("http://s", fetchReturning({ ...healthOk, registration_open: true }));
    expect(res).toEqual({ ok: true, version: "0.1.0", registrationOpen: true });
  });

  it("maps transport failure to unreachable", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await probeServer("http://s", boom)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("maps 503 to unhealthy and an alien payload to not_crossclipper", async () => {
    expect(await probeServer("http://s", fetchReturning({ code: "unhealthy", message: "db" }, 503))).toEqual({ ok: false, reason: "unhealthy" });
    expect(await probeServer("http://s", fetchReturning({ hello: "world" }))).toEqual({ ok: false, reason: "not_crossclipper" });
  });

  it("rejects servers older than MIN_SERVER_VERSION", async () => {
    expect(await probeServer("http://s", fetchReturning({ ...healthOk, version: "0.0.1" }))).toEqual({ ok: false, reason: "server_too_old" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`clients/extension/src/popup/onboarding/probe.ts`:

```ts
import { ApiClient, ApiError, NetworkError } from "@crossclipper/core";
import { CLIENT_VERSION } from "../../background/controller";

/** Oldest server this client can talk to ("client requires newer server"). */
export const MIN_SERVER_VERSION = "0.1.0";

export type ProbeResult =
  | { ok: true; version: string; registrationOpen: boolean }
  | { ok: false; reason: "unreachable" | "unhealthy" | "not_crossclipper" | "server_too_old" };

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname || url.hostname.includes(" ")) return null;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/;

/** Parent spec §5: warn loudly on plain http:// for non-local addresses. */
export function isInsecureHttp(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    return !PRIVATE_HOST.test(u.hostname) && !u.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return true;
}

export async function probeServer(baseUrl: string, fetchFn?: typeof fetch): Promise<ProbeResult> {
  const client = new ApiClient({ baseUrl, clientVersion: CLIENT_VERSION, fetchFn });
  try {
    const health = await client.health();
    if (health.app !== "crossclipper") return { ok: false, reason: "not_crossclipper" };
    if (!semverGte(health.version, MIN_SERVER_VERSION)) {
      return { ok: false, reason: "server_too_old" };
    }
    return { ok: true, version: health.version, registrationOpen: health.registration_open };
  } catch (err) {
    if (err instanceof NetworkError) return { ok: false, reason: "unreachable" };
    if (err instanceof ApiError && err.status === 503) return { ok: false, reason: "unhealthy" };
    return { ok: false, reason: "not_crossclipper" };
  }
}
```

Wait — `health.app !== "crossclipper"`: an alien JSON 200 response parses but has `app: undefined`, which correctly maps to `not_crossclipper`. Good.

`clients/extension/src/popup/onboarding/ServerStep.tsx`:

```tsx
import { useState } from "react";
import browser from "webextension-polyfill";
import { isInsecureHttp, normalizeServerUrl, probeServer, type ProbeResult } from "./probe";

const ERRORS: Record<Exclude<ProbeResult, { ok: true }>["reason"], string> = {
  unreachable: "Can't reach the server — check the address (and your TLS certificate if using https).",
  unhealthy: "The server is reachable but reports itself unhealthy.",
  not_crossclipper: "That address doesn't look like a CrossClipper server.",
  server_too_old: "Your client requires a newer server — update your CrossClipper server.",
};

export interface ServerStepProps {
  initialUrl?: string;
  onNext(baseUrl: string, probe: Extract<ProbeResult, { ok: true }>): void;
}

export function ServerStep({ initialUrl = "", onNext }: ServerStepProps) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalized = normalizeServerUrl(url);
  const insecure = normalized !== null && isInsecureHttp(normalized);

  const next = async () => {
    setError(null);
    setFound(null);
    if (!normalized) {
      setError("Enter your server address, e.g. https://clip.example.com");
      return;
    }
    setBusy(true);
    try {
      try {
        await browser.permissions.request({ origins: [`${new URL(normalized).origin}/*`] });
      } catch {
        /* pre-granted (localhost) or pattern rejected — the probe decides */
      }
      const probe = await probeServer(normalized);
      if (!probe.ok) {
        setError(ERRORS[probe.reason]);
        return;
      }
      setFound(`✓ CrossClipper v${probe.version} found`);
      onNext(normalized, probe);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-step">
      <h2>Your server</h2>
      <p className="text-muted">CrossClipper is self-hosted — point the extension at your server.</p>
      <input
        type="text"
        value={url}
        placeholder="https://clip.example.com"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void next()}
      />
      {insecure && (
        <p className="warning" role="alert">
          ⚠ Plain http:// to a non-local address sends your clipboard and password unencrypted.
          Put TLS in front of your server.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {found && <p className="success">{found}</p>}
      <button disabled={busy} onClick={() => void next()}>
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): onboarding server step with probe, permission request and http warning"
```

## Task 17: Sign-in/create step, appearance step, routing + 401 redirect

**Files:**
- Create: `clients/extension/src/popup/onboarding/SignInStep.tsx`
- Create: `clients/extension/src/popup/onboarding/AppearanceStep.tsx`
- Create: `clients/extension/src/popup/onboarding/Onboarding.tsx`
- Create: `clients/extension/src/popup/components/ThemeControls.tsx`
- Modify: `clients/extension/src/popup/App.tsx` (route: unauthed / authRequired → Onboarding)
- Test: `clients/extension/tests/onboarding.test.tsx`

**Interfaces:**
- Consumes: Task 16 `ServerStep`/`probe`; `ApiClient` from core; `saveAuth`, `saveAppearance`, `SERVER_VERSION_KEY` (Task 12); `requestWorker` (Task 12); theme module (Task 6).
- Produces:
  - `suggestDeviceName(ua?: string, platform?: string): string` (exported from `SignInStep.tsx`) — e.g. `"Windows — Chrome"`, `"Linux — Firefox"`, fallback `"My browser"`.
  - `SignInStep({ baseUrl, mode, notice?, onDone() })` with `mode: "signin" | "create" | "reauth"` — email/password/device-name form; `create` first calls `client.register(email, password)`; all modes then `client.login({ email, password, device_name, platform: "extension" })`, `saveAuth(...)`, store server version under `SERVER_VERSION_KEY`, `requestWorker({ type: "refresh" })`, `onDone()`. Reauth mode shows the notice and skips the device-name field pre-fill reset (keeps stored name).
  - `ThemeControls({ appearance, onChange })` — Light/Dark/Auto segmented control, `ACCENT_PRESETS = ["#d97706", "#2563eb", "#16a34a", "#7c3aed", "#e11d48"]` swatches + `<input type="color">`, live `PreviewCard`; applies via `applyAppearance` on every change (live preview) — reused verbatim by Settings→Look (Task 21).
  - `AppearanceStep({ onFinish() })` — ThemeControls + footer "Skip" / "Start using CrossClipper" (both persist-or-skip then `onFinish`).
  - `Onboarding({ mode?: "fresh" | "reauth"; initialServer?: string; notice?: string; onComplete() })` — 3-step state machine; reauth starts at step 2 with the server pre-filled.
  - `App` route logic: `!state.authed || state.authRequired` → `<Onboarding mode={state.authRequired ? "reauth" : "fresh"} initialServer={state.baseUrl ?? undefined} notice={state.authRequired ? "Session expired or device revoked — sign in again." : undefined} onComplete={() => api.refresh()} />`. After completion the next worker snapshot flips `authed` (popup re-requests `get_state`).

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/onboarding.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeBrowser } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";

const healthOk = { status: "ok", app: "crossclipper", version: "0.1.0", registration_open: false };

function fetchStub(overrides: { registrationOpen?: boolean; loginStatus?: number } = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith("/health")) {
      return new Response(
        JSON.stringify({ ...healthOk, registration_open: overrides.registrationOpen ?? false }),
        { status: 200 },
      );
    }
    if (u.endsWith("/auth/register")) return new Response(JSON.stringify({ user_id: "u1" }), { status: 201 });
    if (u.endsWith("/auth/login")) {
      return new Response(JSON.stringify({ token: "tok", device_id: "dev1" }), {
        status: overrides.loginStatus ?? 200,
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("suggestDeviceName", () => {
  it("derives OS and browser from the user agent", async () => {
    const { suggestDeviceName } = await import("../src/popup/onboarding/SignInStep");
    expect(suggestDeviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0", "Win32")).toBe("Windows — Chrome");
    expect(suggestDeviceName("Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0", "Linux x86_64")).toBe("Linux — Firefox");
    expect(suggestDeviceName("Mozilla/5.0 Edg/126.0", "Win32")).toBe("Windows — Edge");
  });
});

describe("Onboarding", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  beforeEach(() => {
    fake = makeFakeBrowser();
    fake.browser.runtime.onMessage.addListener(() => Promise.resolve({ ok: true }));
    setFakeBrowser(fake.browser);
    localStorage.clear();
  });

  it("walks Server → Sign in → Appearance and persists auth", async () => {
    const { fetchFn, calls } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const onComplete = vi.fn();
    const { Onboarding } = await import("../src/popup/onboarding/Onboarding");
    render(<Onboarding onComplete={onComplete} />);

    await userEvent.type(screen.getByPlaceholderText(/clip.example.com/), "http://127.0.0.1:8080");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    // step 2 (sign-in mode: registration closed)
    expect(await screen.findByText(/sign in/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // step 3
    expect(await screen.findByText(/appearance/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start using crossclipper/i }));
    expect(onComplete).toHaveBeenCalled();

    expect(calls.some((c) => c.url.endsWith("/auth/login"))).toBe(true);
    const stored = JSON.parse(String(fake.storageData["cc.auth"]));
    expect(stored).toMatchObject({ baseUrl: "http://127.0.0.1:8080", token: "tok", deviceId: "dev1" });
    vi.unstubAllGlobals();
  });

  it("first-run servers flip step 2 into account creation and register first", async () => {
    const { fetchFn, calls } = fetchStub({ registrationOpen: true });
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/popup/onboarding/Onboarding");
    render(<Onboarding onComplete={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/clip.example.com/), "http://127.0.0.1:8080");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(/create your account/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByText(/appearance/i);
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.endsWith("/auth/register"))).toBe(true);
    expect(urls.indexOf(urls.find((u) => u.endsWith("/auth/register"))!)).toBeLessThan(
      urls.indexOf(urls.find((u) => u.endsWith("/auth/login"))!),
    );
    vi.unstubAllGlobals();
  });

  it("reauth mode starts at step 2 with the server pre-filled and shows the notice", async () => {
    const { fetchFn } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/popup/onboarding/Onboarding");
    render(
      <Onboarding mode="reauth" initialServer="http://127.0.0.1:8080" notice="Session expired" onComplete={() => {}} />,
    );
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:8080/)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the steps, controls and routing**

`clients/extension/src/popup/onboarding/SignInStep.tsx`:

```tsx
import { useState } from "react";
import { ApiClient } from "@crossclipper/core";
import { CLIENT_VERSION } from "../../background/controller";
import { requestWorker } from "../../shared/messages";
import { saveAuth } from "../../shared/settings";

export function suggestDeviceName(
  ua: string = navigator.userAgent,
  platform: string = navigator.platform,
): string {
  const os = /win/i.test(platform)
    ? "Windows"
    : /mac/i.test(platform)
      ? "Mac"
      : /linux/i.test(platform)
        ? "Linux"
        : "";
  const browserName = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : "Chrome";
  return os ? `${os} — ${browserName}` : "My browser";
}

export interface SignInStepProps {
  baseUrl: string;
  mode: "signin" | "create" | "reauth";
  notice?: string;
  onDone(): void;
}

export function SignInStep({ baseUrl, mode, notice, onDone }: SignInStepProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(suggestDeviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const heading = mode === "create" ? "Create your account" : "Sign in";
  const cta = mode === "create" ? "Create account" : "Sign in";

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const client = new ApiClient({ baseUrl, clientVersion: CLIENT_VERSION });
      if (mode === "create") await client.register(email, password);
      const login = await client.login({
        email,
        password,
        device_name: deviceName,
        platform: "extension",
      });
      await saveAuth({ baseUrl, token: login.token, deviceId: login.device_id, deviceName });
      await requestWorker({ type: "refresh" });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-step">
      <h2>{heading}</h2>
      {notice && <p className="warning" role="alert">{notice}</p>}
      <p className="text-muted">{baseUrl.replace(/^https?:\/\//, "")}</p>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Device name
        <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy || !email || !password} onClick={() => void submit()}>
        {cta}
      </button>
    </div>
  );
}
```

`clients/extension/src/popup/components/ThemeControls.tsx`:

```tsx
import type { Appearance, ThemeSetting } from "../../theme/theme";
import { applyAppearance } from "../../theme/theme";

export const ACCENT_PRESETS = ["#d97706", "#2563eb", "#16a34a", "#7c3aed", "#e11d48"];

export interface ThemeControlsProps {
  appearance: Appearance;
  onChange(a: Appearance): void;
}

export function ThemeControls({ appearance, onChange }: ThemeControlsProps) {
  const update = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    applyAppearance(next); // live preview
    onChange(next);
  };

  return (
    <div className="theme-controls">
      <div className="chips" role="group" aria-label="Theme">
        {(["light", "dark", "auto"] as ThemeSetting[]).map((t) => (
          <button
            key={t}
            className="chip"
            aria-pressed={appearance.theme === t}
            onClick={() => update({ theme: t })}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Accent color">
        {ACCENT_PRESETS.map((hex) => (
          <button
            key={hex}
            className="swatch"
            style={{ background: hex }}
            aria-label={`Accent ${hex}`}
            aria-pressed={appearance.accent === hex}
            onClick={() => update({ accent: hex })}
          />
        ))}
        <input
          type="color"
          aria-label="Custom accent"
          value={appearance.accent}
          onChange={(e) => update({ accent: e.target.value })}
        />
      </div>
      <article className="card preview-card">
        <header className="card-header">
          <span>🌐 Preview</span>
          <time className="text-muted">just now</time>
        </header>
        <p className="card-body">This is how your feed will look.</p>
        <footer className="card-actions">
          <button>⧉ Copy</button>
        </footer>
      </article>
    </div>
  );
}
```

Add to `popup.css`:

```css
.swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); cursor: pointer; }
.swatch[aria-pressed="true"] { border-color: var(--text); }
.onboarding-step { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.onboarding-step label { display: flex; flex-direction: column; gap: var(--space-1); font-size: 12px; }
.onboarding-step input { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); background: var(--surface); color: var(--text); }
.onboarding-step > button { background: var(--accent); color: var(--accent-fg); border: none; border-radius: var(--radius-sm); padding: var(--space-2); cursor: pointer; }
.warning { color: var(--danger); font-size: 12px; }
.error { color: var(--danger); font-size: 12px; }
.success { color: var(--success); font-size: 12px; }
```

`clients/extension/src/popup/onboarding/AppearanceStep.tsx`:

```tsx
import { useState } from "react";
import { DEFAULT_APPEARANCE, type Appearance } from "../../theme/theme";
import { saveAppearance } from "../../shared/settings";
import { ThemeControls } from "../components/ThemeControls";

export function AppearanceStep({ onFinish }: { onFinish(): void }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  const finish = async (persist: boolean) => {
    if (persist) await saveAppearance(appearance);
    onFinish();
  };

  return (
    <div className="onboarding-step">
      <h2>Appearance</h2>
      <ThemeControls appearance={appearance} onChange={setAppearance} />
      <footer className="card-actions">
        <button onClick={() => void finish(false)}>Skip</button>
        <button onClick={() => void finish(true)}>Start using CrossClipper</button>
      </footer>
    </div>
  );
}
```

`clients/extension/src/popup/onboarding/Onboarding.tsx`:

```tsx
import { useState } from "react";
import browser from "webextension-polyfill";
import { SERVER_VERSION_KEY } from "../../shared/settings";
import { AppearanceStep } from "./AppearanceStep";
import { ServerStep } from "./ServerStep";
import { SignInStep } from "./SignInStep";

export interface OnboardingProps {
  mode?: "fresh" | "reauth";
  initialServer?: string;
  notice?: string;
  onComplete(): void;
}

export function Onboarding({ mode = "fresh", initialServer, notice, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(mode === "reauth" && initialServer ? 2 : 1);
  const [baseUrl, setBaseUrl] = useState(initialServer ?? "");
  const [signInMode, setSignInMode] = useState<"signin" | "create" | "reauth">(
    mode === "reauth" ? "reauth" : "signin",
  );

  return (
    <div className="app onboarding">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <span className="text-muted">step {step}/3</span>
      </header>
      {step === 1 && (
        <ServerStep
          initialUrl={baseUrl}
          onNext={(url, probe) => {
            setBaseUrl(url);
            setSignInMode(probe.registrationOpen ? "create" : mode === "reauth" ? "reauth" : "signin");
            void browser.storage.local.set({ [SERVER_VERSION_KEY]: probe.version });
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <SignInStep baseUrl={baseUrl} mode={signInMode} notice={notice} onDone={() => setStep(3)} />
      )}
      {step === 3 && <AppearanceStep onFinish={onComplete} />}
    </div>
  );
}
```

In `clients/extension/src/popup/App.tsx`, after the `if (!state.ready)` guard, add:

```tsx
  if (!state.authed || state.authRequired) {
    return (
      <Onboarding
        mode={state.authRequired ? "reauth" : "fresh"}
        initialServer={state.baseUrl ?? undefined}
        notice={state.authRequired ? "Session expired or device revoked — sign in again." : undefined}
        onComplete={() => void api.refresh()}
      />
    );
  }
```

with `import { Onboarding } from "./onboarding/Onboarding";`. Note: after `onComplete`, the popup re-requests state — add a `get_state` re-fetch to `useWorker` by having the worker push a fresh snapshot on `refresh` (extend `handleRequest`'s `refresh` case in `controller.ts`: `this.broadcast({ type: "snapshot", state: await this.snapshot() })` after wake — one-line change, covered by the reauth test flow).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension && npm run build --workspace @crossclipper/extension`
Expected: all green.

- [ ] **Step 5: Manual smoke — full first-run flow**

Fresh server (`rm -rf /tmp/cc-dev && cd server && CC_SECRET_KEY=dev CC_DATA_DIR=/tmp/cc-dev uv run uvicorn crossclipper.asgi:app --port 8080`), reload the unpacked extension, open the popup: Server step (`http://127.0.0.1:8080`) → "✓ CrossClipper v0.1.0 found" → Create your account → Appearance (pick a non-amber accent, watch the preview re-skin) → feed. Send an item; verify it lands.

- [ ] **Step 6: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): sign-in and appearance onboarding steps with reauth routing"
```

### PR 8 checkpoint

- [ ] Suite + build green; manual first-run flow verified.
- [ ] **STOP — Diego review**, then push + PR `feat(extension): three-step onboarding and re-auth flow`.

---
# PR 9 — Notifications, unread badge, context-menu send

**Needs:** PR 8 merged. (The Settings toggles UI lands in PR 10; behavior here reads `Prefs` with their defaults, so it is fully functional and testable now.)

## Task 18: AlertManager — notification policy + unread badge

**Files:**
- Create: `clients/extension/src/background/alerts.ts`
- Modify: `clients/extension/src/background/index.ts` (wire `onNewItem`, `onPopupOpened`, notification click)
- Test: `clients/extension/tests/alerts.test.ts`

**Interfaces:**
- Consumes: `Item`, `SyncStorage` from core; `Prefs`, `loadPrefs`, `loadAuth` (Task 12).
- Produces:
  ```ts
  export const WATERMARK_KEY = "cc.alert.watermark";
  export const BADGE_COUNT_KEY = "cc.badge.count";
  export interface AlertDeps {
    storage: SyncStorage;
    notifications: { create(id: string, opts: Record<string, unknown>): Promise<string> };
    action: { setBadgeText(d: { text: string }): Promise<void>; setBadgeBackgroundColor(d: { color: string }): Promise<void> };
    getPrefs(): Promise<Prefs>;
    getSelfDeviceId(): Promise<string | null>;
  }
  export class AlertManager {
    constructor(deps: AlertDeps);
    onItem(item: Item): Promise<void>;   // watermark → badge → policy → notification
    clearBadge(): Promise<void>;         // popup opened
    flashBadge(text?: string): Promise<void>; // context-menu confirmation ("✓" for 2s, then restore count)
  }
  ```
- Policy encoded (system spec §4): items older than the watermark → nothing (dedup across worker restarts). Own items (origin == self) advance the watermark silently. Others: badge count +1 always; notification iff `item.target_device_id === selfId` (**always**, toggle irrelevant) OR (`target_device_id` is null/undefined AND `prefs.notifyOnNewItems`). Targeted-at-another-device → badge only, never a banner. Notification body = 120-char snippet, `iconUrl: "icons/icon-128.png"`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/alerts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Item } from "@crossclipper/core";
import type { Prefs } from "../src/shared/settings";

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, kind: "text", body: `body of ${id}`, origin_device_id: "other", target_device_id: null, blob_id: null, created_at: "2026-07-03T00:00:00", deleted_at: null, ...over }) as Item;

function makeAlerts(prefs: Partial<Prefs> = {}) {
  const notifications: Array<{ id: string; opts: Record<string, unknown> }> = [];
  const badges: string[] = [];
  const storage = new MemoryStorage();
  return {
    notifications,
    badges,
    storage,
    async build() {
      const { AlertManager } = await import("../src/background/alerts");
      return new AlertManager({
        storage,
        notifications: { create: async (id, opts) => (notifications.push({ id, opts }), id) },
        action: {
          setBadgeText: async ({ text }) => void badges.push(text),
          setBadgeBackgroundColor: async () => undefined,
        },
        getPrefs: async () => ({ notifyOnNewItems: false, contextMenuSend: true, ...prefs }),
        getSelfDeviceId: async () => "self",
      });
    },
  };
}

describe("AlertManager policy (system spec §4)", () => {
  beforeEach(() => undefined);

  it("targeted at me → always notifies, even with the toggle off", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: false });
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { target_device_id: "self" }));
    expect(ctx.notifications).toHaveLength(1);
    expect(String(ctx.notifications[0]!.opts.message)).toContain("body of 01A");
  });

  it("targeted at another device → badge only, never a banner", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true }); // even with toggle ON
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { target_device_id: "someone-else" }));
    expect(ctx.notifications).toHaveLength(0);
    expect(ctx.badges).toContain("1");
  });

  it("untargeted → silent by default, banner when the toggle is on", async () => {
    const off = makeAlerts();
    await (await off.build()).onItem(item("01A"));
    expect(off.notifications).toHaveLength(0);
    expect(off.badges).toContain("1");

    const on = makeAlerts({ notifyOnNewItems: true });
    await (await on.build()).onItem(item("01A"));
    expect(on.notifications).toHaveLength(1);
  });

  it("own items advance the watermark without badge or banner", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    const alerts = await ctx.build();
    await alerts.onItem(item("01A", { origin_device_id: "self" }));
    expect(ctx.notifications).toHaveLength(0);
    expect(ctx.badges).toHaveLength(0);
    // a re-pull that replays 01A stays silent (watermark)
    await alerts.onItem(item("01A"));
    expect(ctx.notifications).toHaveLength(0);
  });

  it("the watermark survives a restart (new AlertManager over the same storage)", async () => {
    const ctx = makeAlerts({ notifyOnNewItems: true });
    await (await ctx.build()).onItem(item("01B"));
    const again = await ctx.build(); // fresh instance, same storage
    await again.onItem(item("01A")); // older ULID than the watermark
    await again.onItem(item("01B")); // replay
    expect(ctx.notifications).toHaveLength(1);
  });

  it("badge counts accumulate and clear on popup open", async () => {
    const ctx = makeAlerts();
    const alerts = await ctx.build();
    await alerts.onItem(item("01A"));
    await alerts.onItem(item("01B"));
    expect(ctx.badges).toEqual(["1", "2"]);
    await alerts.clearBadge();
    expect(ctx.badges.at(-1)).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`clients/extension/src/background/alerts.ts`:

```ts
import type { Item, SyncStorage } from "@crossclipper/core";
import type { Prefs } from "../shared/settings";

export const WATERMARK_KEY = "cc.alert.watermark";
export const BADGE_COUNT_KEY = "cc.badge.count";

export interface AlertDeps {
  storage: SyncStorage;
  notifications: { create(id: string, opts: Record<string, unknown>): Promise<string> };
  action: {
    setBadgeText(d: { text: string }): Promise<void>;
    setBadgeBackgroundColor(d: { color: string }): Promise<void>;
  };
  getPrefs(): Promise<Prefs>;
  getSelfDeviceId(): Promise<string | null>;
}

/** Notification policy + unread badge (system spec §4, extension spec §6).
 *  ULID watermark = dedup across MV3 worker restarts and cursor re-pulls. */
export class AlertManager {
  constructor(private readonly deps: AlertDeps) {}

  async onItem(item: Item): Promise<void> {
    const watermark = await this.deps.storage.get(WATERMARK_KEY);
    if (watermark && item.id <= watermark) return;
    await this.deps.storage.set(WATERMARK_KEY, item.id);

    const selfId = await this.deps.getSelfDeviceId();
    if (!selfId || item.origin_device_id === selfId) return;

    const count = Number((await this.deps.storage.get(BADGE_COUNT_KEY)) ?? "0") + 1;
    await this.deps.storage.set(BADGE_COUNT_KEY, String(count));
    await this.deps.action.setBadgeBackgroundColor({ color: "#d97706" });
    await this.deps.action.setBadgeText({ text: String(count) });

    const targetedAtMe = item.target_device_id === selfId;
    const targetedElsewhere = item.target_device_id != null && !targetedAtMe;
    if (targetedElsewhere) return; // sync silently: badge only

    const prefs = await this.deps.getPrefs();
    if (targetedAtMe || prefs.notifyOnNewItems) {
      await this.deps.notifications.create(`cc-item-${item.id}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: targetedAtMe ? "Sent to this device" : "New item",
        message: item.body.slice(0, 120),
      });
    }
  }

  async clearBadge(): Promise<void> {
    await this.deps.storage.set(BADGE_COUNT_KEY, "0");
    await this.deps.action.setBadgeText({ text: "" });
  }

  async flashBadge(text = "✓"): Promise<void> {
    await this.deps.action.setBadgeBackgroundColor({ color: "#16a34a" });
    await this.deps.action.setBadgeText({ text });
    setTimeout(() => {
      void (async () => {
        const count = Number((await this.deps.storage.get(BADGE_COUNT_KEY)) ?? "0");
        await this.deps.action.setBadgeBackgroundColor({ color: "#d97706" });
        await this.deps.action.setBadgeText({ text: count > 0 ? String(count) : "" });
      })();
    }, 2000);
  }
}
```

Wire it in `clients/extension/src/background/index.ts` — replace the controller construction and add the notification-click handler:

```ts
import browser from "webextension-polyfill";
import { EVENTS_PORT, isPopupRequest } from "../shared/messages";
import { loadAuth, loadPrefs } from "../shared/settings";
import { ExtensionStorage } from "../shared/storage";
import { AlertManager } from "./alerts";
import { BackgroundController } from "./controller";
import { browserSocketFactory } from "./socket";

const storage = new ExtensionStorage();

const alerts = new AlertManager({
  storage,
  notifications: browser.notifications,
  action: browser.action,
  getPrefs: loadPrefs,
  getSelfDeviceId: async () => (await loadAuth())?.deviceId ?? null,
});

const controller = new BackgroundController({
  storage,
  socketFactory: browserSocketFactory,
  onNewItem: (item) => void alerts.onItem(item),
});
controller.onPopupOpened = () => void alerts.clearBadge();

browser.notifications.onClicked.addListener(() => {
  void browser.action.openPopup().catch(() =>
    browser.windows.create({
      url: browser.runtime.getURL("src/popup/index.html"),
      type: "popup",
      width: 380,
      height: 540,
    }),
  );
});
```

(keep the existing onMessage/onConnect/alarm/wake wiring below, unchanged, and keep `export { controller }` — add `export { alerts }` next to it for Task 19).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): notification policy and unread badge with restart-safe watermark"
```

## Task 19: Context-menu send

**Files:**
- Create: `clients/extension/src/background/menus.ts`
- Modify: `clients/extension/src/background/index.ts` (wire menus)
- Test: `clients/extension/tests/menus.test.ts`

**Interfaces:**
- Consumes: `BackgroundController.handleRequest` (Task 13), `AlertManager.flashBadge` (Task 18), `Prefs`/`PREFS_KEY`/`loadPrefs` (Task 12).
- Produces:
  ```ts
  export const MENU_SELECTION = "cc-send-selection";
  export const MENU_LINK = "cc-send-link";
  export interface MenuDeps {
    contextMenus: { create(opts: Record<string, unknown>): unknown; removeAll(): Promise<void> };
    send(kind: "text" | "link", body: string): Promise<void>;   // → controller.handleRequest send, untargeted
    flash(): Promise<void>;
  }
  export async function syncContextMenus(deps: MenuDeps, prefs: Prefs): Promise<void>;
  export async function onMenuClicked(deps: MenuDeps, info: { menuItemId: string | number; selectionText?: string; linkUrl?: string }): Promise<void>;
  ```
- Behavior: `syncContextMenus` always `removeAll()` first; creates "Send selection to CrossClipper" (`contexts: ["selection"]`) and "Send link to CrossClipper" (`contexts: ["link"]`) only when `prefs.contextMenuSend`; clicks post untargeted (`targetDeviceId: null` — the speed path is silent, mirroring the desktop hotkey policy) and flash the badge. Re-synced on `browser.storage.onChanged` for `PREFS_KEY` and on `onInstalled`.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/menus.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Prefs } from "../src/shared/settings";

function makeDeps() {
  const created: Record<string, unknown>[] = [];
  let removed = 0;
  const send = vi.fn(async () => undefined);
  const flash = vi.fn(async () => undefined);
  return {
    created,
    send,
    flash,
    removedCount: () => removed,
    deps: {
      contextMenus: {
        create: (opts: Record<string, unknown>) => created.push(opts),
        removeAll: async () => void removed++,
      },
      send,
      flash,
    },
  };
}

const prefs = (on: boolean): Prefs => ({ notifyOnNewItems: false, contextMenuSend: on });

describe("context menus", () => {
  it("creates both entries when enabled, none when disabled — always resetting first", async () => {
    const { syncContextMenus } = await import("../src/background/menus");
    const ctx = makeDeps();
    await syncContextMenus(ctx.deps, prefs(true));
    expect(ctx.removedCount()).toBe(1);
    expect(ctx.created.map((c) => c.id)).toEqual(["cc-send-selection", "cc-send-link"]);
    await syncContextMenus(ctx.deps, prefs(false));
    expect(ctx.removedCount()).toBe(2);
    expect(ctx.created).toHaveLength(2); // nothing new created
  });

  it("selection clicks send text; link clicks send the link URL; both flash", async () => {
    const { onMenuClicked, MENU_LINK, MENU_SELECTION } = await import("../src/background/menus");
    const ctx = makeDeps();
    await onMenuClicked(ctx.deps, { menuItemId: MENU_SELECTION, selectionText: "picked words" });
    expect(ctx.send).toHaveBeenCalledWith("text", "picked words");
    await onMenuClicked(ctx.deps, { menuItemId: MENU_LINK, linkUrl: "https://example.com/x" });
    expect(ctx.send).toHaveBeenCalledWith("link", "https://example.com/x");
    expect(ctx.flash).toHaveBeenCalledTimes(2);
  });

  it("ignores unknown menu ids and empty payloads", async () => {
    const { onMenuClicked, MENU_SELECTION } = await import("../src/background/menus");
    const ctx = makeDeps();
    await onMenuClicked(ctx.deps, { menuItemId: "someone-elses-menu" });
    await onMenuClicked(ctx.deps, { menuItemId: MENU_SELECTION });
    expect(ctx.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`clients/extension/src/background/menus.ts`:

```ts
import type { Prefs } from "../shared/settings";

export const MENU_SELECTION = "cc-send-selection";
export const MENU_LINK = "cc-send-link";

export interface MenuDeps {
  contextMenus: {
    create(opts: Record<string, unknown>): unknown;
    removeAll(): Promise<void>;
  };
  send(kind: "text" | "link", body: string): Promise<void>;
  flash(): Promise<void>;
}

export async function syncContextMenus(deps: MenuDeps, prefs: Prefs): Promise<void> {
  await deps.contextMenus.removeAll();
  if (!prefs.contextMenuSend) return;
  deps.contextMenus.create({
    id: MENU_SELECTION,
    title: "Send selection to CrossClipper",
    contexts: ["selection"],
  });
  deps.contextMenus.create({
    id: MENU_LINK,
    title: "Send link to CrossClipper",
    contexts: ["link"],
  });
}

export async function onMenuClicked(
  deps: MenuDeps,
  info: { menuItemId: string | number; selectionText?: string; linkUrl?: string },
): Promise<void> {
  if (info.menuItemId === MENU_SELECTION && info.selectionText) {
    await deps.send("text", info.selectionText);
    await deps.flash();
  } else if (info.menuItemId === MENU_LINK && info.linkUrl) {
    await deps.send("link", info.linkUrl);
    await deps.flash();
  }
}
```

Wire in `clients/extension/src/background/index.ts` (below the alerts wiring):

```ts
import { PREFS_KEY } from "../shared/settings";
import { onMenuClicked, syncContextMenus } from "./menus";

const menuDeps = {
  contextMenus: browser.contextMenus,
  send: async (kind: "text" | "link", body: string) => {
    await controller.handleRequest({ type: "send", kind, body, targetDeviceId: null });
  },
  flash: () => alerts.flashBadge(),
};

browser.contextMenus.onClicked.addListener((info) => void onMenuClicked(menuDeps, info));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && PREFS_KEY in changes) {
    void loadPrefs().then((p) => syncContextMenus(menuDeps, p));
  }
});
```

and inside the existing `onInstalled` listener add `void loadPrefs().then((p) => syncContextMenus(menuDeps, p));`.

- [ ] **Step 4: Run tests + manual smoke**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension && npm run build --workspace @crossclipper/extension`
Expected: green. Manual: reload unpacked, select text on any page → right-click → "Send selection to CrossClipper" → badge flashes ✓, item appears in popup and on the server.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): context-menu send for selections and links with badge flash"
```

### PR 9 checkpoint

- [ ] Suite + build green; targeted-notification manual check: send an item from another device (CLI or curl) with `target_device_id` = the extension's device → browser notification appears even with the toggle off.
- [ ] **STOP — Diego review**, then push + PR `feat(extension): notifications, unread badge and context-menu send`.

---

# PR 10 — Settings page

**Needs:** PR 9 merged.

## Task 20: Settings shell, server status card, Devices tab

**Files:**
- Create: `clients/extension/src/popup/settings/Settings.tsx`
- Create: `clients/extension/src/popup/settings/DevicesTab.tsx`
- Modify: `clients/extension/src/popup/App.tsx` (⚙ ↔ back-arrow routing)
- Test: `clients/extension/tests/settingsPage.test.tsx`

**Interfaces:**
- Consumes: `PopupState`, `WorkerApi` (Task 14); `DeviceView`, `toDeviceView`, `platformIcon`, `parseUtc` (Task 7); `SERVER_VERSION_KEY` (Task 12).
- Produces:
  - `STALE_AFTER_DAYS = 14` (exported from `DevicesTab.tsx`); `isStale(lastSeenAt: string, now?: Date): boolean`.
  - `Settings({ state, api, onBack() })` — full-popup page: back arrow + "Settings" header; pinned server status card (host, `● Connected` when `state.status === "live"` else `● Disconnected`, `Server v{version}` read from `browser.storage.local[SERVER_VERSION_KEY]`, Sign out button → `api.signOut()` then `onBack()`); segmented tabs Devices / Look / General (default Devices).
  - `DevicesTab({ devices: DeviceView[]; api })` — rich rows: platform icon, name, "this device" badge for `isSelf`, presence line ("online now" / "last seen {relativeTime}"), inline ✎ rename (input + Enter → `api.renameDevice`), ⊘ revoke as a two-click confirm (`⊘` → button relabels "Revoke?" → click again → `api.revokeDevice`); rows stale ≥14 days get the highlighted "Revoke?" nudge chip.
  - `App`: `const [view, setView] = useState<"feed" | "settings">("feed")` — ⚙ button opens settings; settings back arrow returns.

- [ ] **Step 1: Write the failing tests**

`clients/extension/tests/settingsPage.test.tsx` (Devices-tab half; Task 21 appends the Look/General cases):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeBrowser } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";
import type { PopupState, WorkerApi } from "../src/popup/useWorker";

const NOW = new Date("2026-07-03T12:00:00Z");

const devices = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, last_seen_at: "2026-07-03T11:59:30", created_at: "2026-07-01T00:00:00" },
  { id: "d2", name: "Pixel 8", platform: "android", online: true, last_seen_at: "2026-07-03T11:59:00", created_at: "2026-07-01T00:00:00" },
  { id: "d3", name: "Old tablet", platform: "other", online: false, last_seen_at: "2026-06-01T00:00:00", created_at: "2026-05-01T00:00:00" },
];

const state: PopupState = {
  ready: true, authed: true, authRequired: false,
  baseUrl: "https://clip.example.com", deviceId: "self", status: "live",
  items: [], pending: [], devices,
};

function makeApi(): WorkerApi {
  return {
    send: vi.fn(), retry: vi.fn(), deleteItem: vi.fn(), refresh: vi.fn(),
    renameDevice: vi.fn(async () => undefined), revokeDevice: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } as unknown as WorkerApi;
}

describe("Settings — shell and Devices tab", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  beforeEach(() => {
    fake = makeFakeBrowser();
    fake.storageData["cc.serverVersion"] = "0.1.0";
    setFakeBrowser(fake.browser);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    return () => vi.useRealTimers();
  });

  async function renderSettings(api = makeApi()) {
    const { Settings } = await import("../src/popup/settings/Settings");
    const onBack = vi.fn();
    render(<Settings state={state} api={api} onBack={onBack} />);
    return { api, onBack };
  }

  it("shows the server status card with host, connection and version", async () => {
    await renderSettings();
    expect(screen.getByText(/clip\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/● Connected/)).toBeInTheDocument();
    expect(await screen.findByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it("sign out calls the api and navigates back", async () => {
    vi.useRealTimers();
    const { api, onBack } = await renderSettings();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(api.signOut).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it("lists devices with this-device badge and presence", async () => {
    await renderSettings();
    expect(screen.getByText(/this device/i)).toBeInTheDocument();
    expect(screen.getAllByText(/online now/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/last seen .*ago|last seen/i)).toBeInTheDocument();
  });

  it("stale devices (≥14 days) get the revoke nudge", async () => {
    await renderSettings();
    const row = screen.getByText("Old tablet").closest(".device-row")!;
    expect(row.querySelector(".nudge")).toBeTruthy();
    const fresh = screen.getByText("Pixel 8").closest(".device-row")!;
    expect(fresh.querySelector(".nudge")).toBeFalsy();
  });

  it("inline rename submits on Enter", async () => {
    vi.useRealTimers();
    const { api } = await renderSettings();
    const row = screen.getByText("Pixel 8").closest(".device-row")!;
    await userEvent.click(row.querySelector('[aria-label="Rename"]')!);
    const input = screen.getByDisplayValue("Pixel 8");
    await userEvent.clear(input);
    await userEvent.type(input, "Phone{Enter}");
    expect(api.renameDevice).toHaveBeenCalledWith("d2", "Phone");
  });

  it("revoke needs a second confirming click", async () => {
    vi.useRealTimers();
    const { api } = await renderSettings();
    const row = screen.getByText("Pixel 8").closest(".device-row")!;
    await userEvent.click(row.querySelector('[aria-label="Revoke"]')!);
    expect(api.revokeDevice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /revoke\?/i }));
    expect(api.revokeDevice).toHaveBeenCalledWith("d2");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`clients/extension/src/popup/settings/DevicesTab.tsx`:

```tsx
import { useState } from "react";
import { relativeTime } from "../format";
import { parseUtc, platformIcon, type DeviceView } from "../../shared/model";
import type { WorkerApi } from "../useWorker";

export const STALE_AFTER_DAYS = 14;

export function isStale(lastSeenAt: string, now: Date = new Date()): boolean {
  return now.getTime() - parseUtc(lastSeenAt).getTime() > STALE_AFTER_DAYS * 86_400_000;
}

export function DevicesTab({ devices, api }: { devices: DeviceView[]; api: WorkerApi }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <ul className="device-list">
      {devices.map((d) => (
        <li key={d.id} className="device-row">
          <span aria-hidden>{platformIcon(d.platform)}</span>
          <div className="device-main">
            {renaming === d.id ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    void api.renameDevice(d.id, name.trim());
                    setRenaming(null);
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span>
                {d.name} {d.isSelf && <em className="badge">this device</em>}
                {isStale(d.lastSeenAt) && <em className="nudge">Revoke?</em>}
              </span>
            )}
            <span className="text-muted presence">
              {d.online ? "online now" : `last seen ${relativeTime(d.lastSeenAt)}`}
            </span>
          </div>
          <button
            aria-label="Rename"
            onClick={() => {
              setRenaming(d.id);
              setName(d.name);
            }}
          >
            ✎
          </button>
          {!d.isSelf &&
            (confirming === d.id ? (
              <button className="danger" onClick={() => void api.revokeDevice(d.id)}>
                Revoke?
              </button>
            ) : (
              <button aria-label="Revoke" className="danger" onClick={() => setConfirming(d.id)}>
                ⊘
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
}
```

`clients/extension/src/popup/settings/Settings.tsx`:

```tsx
import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { SERVER_VERSION_KEY } from "../../shared/settings";
import { toDeviceView } from "../../shared/model";
import type { PopupState, WorkerApi } from "../useWorker";
import { DevicesTab } from "./DevicesTab";
import { GeneralTab } from "./GeneralTab";
import { LookTab } from "./LookTab";

type Tab = "devices" | "look" | "general";

export function Settings({ state, api, onBack }: { state: PopupState; api: WorkerApi; onBack(): void }) {
  const [tab, setTab] = useState<Tab>("devices");
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    void browser.storage.local.get(SERVER_VERSION_KEY).then((res) => {
      const v = res[SERVER_VERSION_KEY];
      if (typeof v === "string") setServerVersion(v);
    });
  }, []);

  const host = state.baseUrl?.replace(/^https?:\/\//, "") ?? "—";
  const deviceViews = state.devices.map((d) => toDeviceView(d, state.deviceId));

  return (
    <div className="app settings">
      <header className="header">
        <button aria-label="Back" onClick={onBack}>←</button>
        <span>Settings</span>
        <span />
      </header>
      <section className="card status-card">
        <div>
          <strong>{host}</strong>
          <span className={state.status === "live" ? "success" : "text-muted"}>
            {state.status === "live" ? " ● Connected" : " ● Disconnected"}
          </span>
        </div>
        <div className="text-muted">{serverVersion ? `Server v${serverVersion}` : ""}</div>
        <button
          className="danger"
          onClick={() => {
            void api.signOut();
            onBack();
          }}
        >
          Sign out
        </button>
      </section>
      <nav className="chips tabs" role="tablist">
        {(["devices", "look", "general"] as Tab[]).map((t) => (
          <button key={t} className="chip" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "devices" && <DevicesTab devices={deviceViews} api={api} />}
        {tab === "look" && <LookTab />}
        {tab === "general" && <GeneralTab />}
      </div>
    </div>
  );
}
```

(`LookTab`/`GeneralTab` are Task 21 — create empty placeholder components now so this compiles:
`export function LookTab() { return null; }` in `LookTab.tsx`, same for `GeneralTab.tsx`; Task 21 replaces them.)

`clients/extension/src/popup/App.tsx` — add the view switch:

```tsx
  const [view, setView] = useState<"feed" | "settings">("feed");
  // … after the onboarding guard:
  if (view === "settings") {
    return <Settings state={state} api={api} onBack={() => setView("feed")} />;
  }
```

and change the header button to `<button aria-label="Settings" onClick={() => setView("settings")}>⚙</button>`; import `Settings`.

Add to `popup.css`:

```css
.settings { grid-template-rows: auto auto auto 1fr; }
.status-card { margin: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); }
.tabs { padding: 0 var(--space-3); }
.tab-body { overflow-y: auto; padding: var(--space-2) var(--space-3); }
.device-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.device-row { display: flex; align-items: center; gap: var(--space-2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-2); }
.device-main { flex: 1; display: flex; flex-direction: column; }
.presence { font-size: 11px; }
.badge { background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 0 var(--space-2); font-style: normal; font-size: 10px; margin-left: var(--space-1); }
.nudge { background: var(--danger); color: #fff; border-radius: 999px; padding: 0 var(--space-2); font-style: normal; font-size: 10px; margin-left: var(--space-1); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): settings shell with server status card and devices tab"
```

## Task 21: Look + General tabs

**Files:**
- Modify: `clients/extension/src/popup/settings/LookTab.tsx` (replace placeholder)
- Modify: `clients/extension/src/popup/settings/GeneralTab.tsx` (replace placeholder)
- Test: append to `clients/extension/tests/settingsPage.test.tsx`

**Interfaces:**
- Consumes: `ThemeControls` (Task 17), `loadAppearanceStored`/`saveAppearance`/`loadPrefs`/`savePrefs` (Task 12).
- Produces: `LookTab()` — loads stored appearance, renders `ThemeControls`, persists via `saveAppearance` on every change (same components as onboarding step 3, per spec §5). `GeneralTab()` — two labeled checkboxes bound to `Prefs`: "Notify me on new items" (`notifyOnNewItems`) and "Context-menu send" (`contextMenuSend`); persists via `savePrefs` (which triggers the worker's menu re-sync through `storage.onChanged`, Task 19).

- [ ] **Step 1: Write the failing tests** — append to `settingsPage.test.tsx`:

```tsx
describe("Settings — Look and General tabs", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  beforeEach(() => {
    fake = makeFakeBrowser();
    setFakeBrowser(fake.browser);
    localStorage.clear();
  });

  it("Look persists accent changes through saveAppearance", async () => {
    const { LookTab } = await import("../src/popup/settings/LookTab");
    render(<LookTab />);
    await userEvent.click(await screen.findByRole("button", { name: /accent #2563eb/i }));
    expect(JSON.parse(String(fake.storageData["cc.appearanceStored"]))).toMatchObject({
      accent: "#2563eb",
    });
  });

  it("General renders defaults (notify off, context menu on) and persists toggles", async () => {
    const { GeneralTab } = await import("../src/popup/settings/GeneralTab");
    render(<GeneralTab />);
    const notify = await screen.findByRole("checkbox", { name: /notify me on new items/i });
    const menu = screen.getByRole("checkbox", { name: /context-menu send/i });
    expect(notify).not.toBeChecked();
    expect(menu).toBeChecked();
    await userEvent.click(notify);
    expect(JSON.parse(String(fake.storageData["cc.prefs"]))).toMatchObject({
      notifyOnNewItems: true,
      contextMenuSend: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace @crossclipper/extension`
Expected: FAIL — placeholders render nothing.

- [ ] **Step 3: Implement**

`clients/extension/src/popup/settings/LookTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import { DEFAULT_APPEARANCE, type Appearance } from "../../theme/theme";
import { loadAppearanceStored, saveAppearance } from "../../shared/settings";
import { ThemeControls } from "../components/ThemeControls";

export function LookTab() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);

  useEffect(() => {
    void loadAppearanceStored().then(setAppearance);
  }, []);

  if (!appearance) return null;
  return (
    <ThemeControls
      appearance={appearance}
      onChange={(a) => {
        setAppearance(a);
        void saveAppearance(a);
      }}
    />
  );
}
```

`clients/extension/src/popup/settings/GeneralTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import { loadPrefs, savePrefs, type Prefs } from "../../shared/settings";

export function GeneralTab() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
  }, []);

  if (!prefs) return null;
  const toggle = (patch: Partial<Prefs>) => {
    void savePrefs(patch).then(setPrefs);
  };

  return (
    <div className="general-tab">
      <label>
        <input
          type="checkbox"
          checked={prefs.notifyOnNewItems}
          onChange={(e) => toggle({ notifyOnNewItems: e.target.checked })}
        />
        Notify me on new items
      </label>
      <p className="text-muted">
        Off by default — items targeted at this device always notify.
      </p>
      <label>
        <input
          type="checkbox"
          checked={prefs.contextMenuSend}
          onChange={(e) => toggle({ contextMenuSend: e.target.checked })}
        />
        Context-menu send
      </label>
    </div>
  );
}
```

Add to `popup.css`:

```css
.general-tab { display: flex; flex-direction: column; gap: var(--space-2); font-size: 13px; }
.general-tab label { display: flex; align-items: center; gap: var(--space-2); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/extension && npm run typecheck --workspace @crossclipper/extension && npm run build --workspace @crossclipper/extension`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add clients/extension/src clients/extension/tests
git commit -m "feat(extension): look and general settings tabs with persisted preferences"
```

### PR 10 checkpoint

- [ ] Suite + build green; manual pass through all three tabs (rename, revoke, accent change with live re-skin, toggles).
- [ ] **STOP — Diego review**, then push + PR `feat(extension): settings page (devices, look, general)`.

---

# PR 11 — Playwright E2E + Firefox build variant

**Needs:** PR 10 merged; `uv` available (spawns the real server).

## Task 22: Happy-path E2E (extension spec §9)

Journey: onboard against a fresh local server (first-run → account creation) → send text → item appears → second device posts via raw API → card arrives live → copy → filter by device.

**Files:**
- Create: `clients/extension/e2e/playwright.config.ts`, `clients/extension/e2e/server.ts`, `clients/extension/e2e/fixtures.ts`, `clients/extension/e2e/tests/happy-path.spec.ts`
- Modify: `clients/extension/package.json` (add `@playwright/test` devDependency + `"e2e": "playwright test --config e2e/playwright.config.ts"` script)
- Modify: `.github/workflows/ci.yml` (extension-e2e job)

**Interfaces:**
- Consumes: built `dist/` (Chromium, pre-granted localhost host permissions make onboarding prompt-free); `crossclipper.asgi:app`.
- Produces: `test`/`expect` fixtures with `{ context, extensionId, popupUrl, server }`; `startServer(): Promise<TestServer>` where `TestServer = { baseUrl: string; stop(): Promise<void> }`.

- [ ] **Step 1: Install and configure**

```bash
npm install --save-dev @playwright/test --workspace @crossclipper/extension
npx playwright install chromium
```

`clients/extension/e2e/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1, // one persistent context + one server
  retries: process.env.CI ? 1 : 0,
  outputDir: "../e2e-results",
  use: { trace: "retain-on-failure" },
});
```

`clients/extension/e2e/server.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TestServer {
  baseUrl: string;
  stop(): Promise<void>;
}

const SERVER_DIR = path.resolve(__dirname, "../../../server");

export async function startServer(port = 8790): Promise<TestServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "cc-e2e-ext-"));
  const proc: ChildProcess = spawn(
    "uv",
    ["run", "uvicorn", "crossclipper.asgi:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, CC_SECRET_KEY: "e2e-ext", CC_DATA_DIR: dataDir },
      stdio: "pipe",
    },
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
    if (i === 59) throw new Error("server did not become healthy");
  }
  return {
    baseUrl,
    stop: async () => {
      proc.kill();
      await new Promise((r) => setTimeout(r, 200));
    },
  };
}
```

`clients/extension/e2e/fixtures.ts`:

```ts
import { chromium, test as base, type BrowserContext } from "@playwright/test";
import path from "node:path";
import { startServer, type TestServer } from "./server";

const DIST = path.resolve(__dirname, "../dist");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popupUrl: string;
  server: TestServer;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", // new headless supports extensions; use xvfb-run if the runner's channel doesn't
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent("serviceworker");
    await use(new URL(sw.url()).host);
  },
  popupUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/src/popup/index.html`);
  },
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startServer();
    await use(server);
    await server.stop();
  },
});

export const expect = test.expect;
```

- [ ] **Step 2: Write the journey**

`clients/extension/e2e/tests/happy-path.spec.ts`:

```ts
import { expect, test } from "../fixtures";

test("onboard → send → receive live → copy → filter", async ({ page, popupUrl, server }) => {
  await page.goto(popupUrl);

  // --- Onboarding: fresh server ⇒ step 2 is account creation
  await page.getByPlaceholder(/clip.example.com/).fill(server.baseUrl);
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page.getByText(/✓ CrossClipper v/)).toBeVisible();

  await expect(page.getByText(/create your account/i)).toBeVisible();
  await page.getByLabel(/email/i).fill("owner@example.com");
  await page.getByLabel(/password/i).fill("password123!");
  await page.getByLabel(/device name/i).fill("E2E Chrome");
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page.getByText(/appearance/i)).toBeVisible();
  await page.getByRole("button", { name: /start using crossclipper/i }).click();

  // --- Empty feed hint, then send
  await expect(page.getByText(/copy something on another device/i)).toBeVisible();
  await page.getByRole("textbox").fill("hello from e2e");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByText("hello from e2e")).toBeVisible();

  // --- Second device posts via the raw API (login registers the device)
  const login = await (
    await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password123!",
        device_name: "Fake phone",
        platform: "android",
      }),
    })
  ).json();
  await fetch(`${server.baseUrl}/api/v1/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ kind: "text", body: "from the phone" }),
  });

  // --- Arrives live over WS (no reload)
  await expect(page.getByText("from the phone")).toBeVisible({ timeout: 10_000 });

  // --- Copy shows confirmation
  const phoneCard = page.locator("article", { hasText: "from the phone" });
  await phoneCard.getByRole("button", { name: /copy/i }).click();
  await expect(phoneCard.getByText(/copied ✓/i)).toBeVisible();

  // --- Rail filter: only the phone's item remains visible
  await page.getByRole("button", { name: /fake phone/i }).click();
  await expect(page.getByText("from the phone")).toBeVisible();
  await expect(page.getByText("hello from e2e")).toBeHidden();
});
```

- [ ] **Step 3: Run it**

```bash
npm run build --workspace @crossclipper/extension
npm run e2e --workspace @crossclipper/extension
```

Expected: 1 passed. If the runner's Chromium refuses extensions headless, prefix with `xvfb-run -a` (and use that form in CI).

- [ ] **Step 4: Add the CI job**

In `.github/workflows/ci.yml`:

```yaml
  extension-e2e:
    name: Extension E2E (Playwright)
    runs-on: ubuntu-latest
    needs: extension
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: uv sync
        working-directory: server
      - run: npm ci
      - run: npm run build --workspace @crossclipper/extension
      - run: npx playwright install --with-deps chromium
      - run: xvfb-run -a npm run e2e --workspace @crossclipper/extension
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: clients/extension/e2e-results
```

- [ ] **Step 5: Commit**

```bash
git add clients/extension/e2e clients/extension/package.json package-lock.json .github/workflows/ci.yml
git commit -m "test(extension): playwright happy-path E2E against a real server"
```

## Task 23: Firefox build variant

**Files:**
- Create: `clients/extension/scripts/build-firefox.mjs`
- Modify: `clients/extension/package.json` (script `"build:firefox": "npm run build && node scripts/build-firefox.mjs"`)

**Interfaces:**
- Consumes: `dist/` (Chrome build output).
- Produces: `dist-firefox/` — same bundle with a Firefox-compatible manifest: `background.scripts` (event page) instead of `service_worker`, plus `browser_specific_settings.gecko`. Manual smoke only this phase (ambiguity 10); store packaging is out of scope (spec §10).

- [ ] **Step 1: Write the transform**

`clients/extension/scripts/build-firefox.mjs`:

```js
// Firefox MV3 variant: copies dist/ and swaps the background entry.
// Firefox runs MV3 backgrounds as event pages (background.scripts), not
// service workers. All runtime code already goes through webextension-polyfill.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dist = new URL("../dist", import.meta.url).pathname;
const out = new URL("../dist-firefox", import.meta.url).pathname;

rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });

const manifestPath = path.join(out, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const worker = manifest.background?.service_worker;
if (!worker) throw new Error("no background.service_worker in dist manifest");
manifest.background = { scripts: [worker], type: "module" };
manifest.browser_specific_settings = {
  gecko: { id: "crossclipper@self-hosted", strict_min_version: "121.0" },
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`firefox build written to ${out}`);
```

- [ ] **Step 2: Build and verify**

```bash
npm run build:firefox --workspace @crossclipper/extension
node -e "const m=require('./clients/extension/dist-firefox/manifest.json'); if(!m.background.scripts||m.background.service_worker) process.exit(1); console.log('manifest ok')"
```

Expected: `manifest ok`.

- [ ] **Step 3: Manual Firefox smoke**

Firefox → `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → pick `dist-firefox/manifest.json`. Verify: onboarding against the local server, send/receive, context menu. (Known acceptable gap: Firefox may prompt for the optional host permission differently; localhost works without prompts.)

- [ ] **Step 4: Commit**

```bash
git add clients/extension/scripts/build-firefox.mjs clients/extension/package.json
git commit -m "feat(extension): firefox build variant via manifest transform"
```

### PR 11 checkpoint

- [ ] Playwright E2E green locally and in CI; Firefox manual smoke done (note results in the PR description).
- [ ] **STOP — Diego review**, then push + PR `test(extension): playwright happy-path E2E and firefox build variant`.

---

# Self-review (performed while writing)

- **Extension spec coverage:** §2 validated decisions → sidebar rail (Task 8), always-visible card actions (Task 7), system-adaptive tokens + manual override (Task 6), slate + user accent default amber (Task 6), 3-step onboarding (Tasks 16–17), tabbed settings (Tasks 20–21). §3 popup → rail filter (Task 15, client-side per ambiguity 3), cards + unknown-kind fallback + linkified bodies (Task 7), copy w/ "Copied ✓" (Task 7), compose Enter/Shift+Enter + target chips + optimistic outbox render (Tasks 8/13/15), new-item pill (Task 15). §4 onboarding → probe results incl. first-run create mode (Tasks 16–17, server support Task 10), http warning (Task 16), device-name suggestion (Task 17). §5 settings → status card, rich device rows, 14-day nudge (Task 20), Look reuse (Task 21), General toggles (Task 21). §6 architecture → single engine in worker (Task 13), storage.local cache + instant popup render (FeedStore, Task 12), alarms tick (Task 13), auth in storage.local (Task 12), notification policy (Task 18), context menu (Task 19), badge (Task 18). §7 tokens (Task 6, names verbatim). §8 error states → reconnecting banner (Task 15), 401 single redirect (Tasks 14/17), empty feed (Task 15), not-sent retry (Tasks 13/15), version skew (Task 16 client-side + 426 via core). §9 testing → component tests throughout, messaging contract tests (Task 12), one Playwright happy path (Task 22). §10 exclusions respected (no media UI, no clipboard capture, no store publication).
- **System spec §7 coverage:** non-root UID 1000 + curl + single /data + fail-fast message (Tasks 1–2), compose file verbatim-equivalent (Task 2), zero-config SQLite default (image env), healthcheck wiring (Tasks 2/4), env-var table documented (Task 2), GHCR publish (Task 4). Deferred: structured JSON logs (ambiguity 13), Postgres/S3 backends (Phase 1 already scoped them out of the MVP image — config keys reserved).
- **E2E spec Layer D coverage:** same journey suite against the container via `CC_E2E_BASE_URL` (Task 3), documented compose file exercised with an override (Task 4), non-root//data/healthcheck/env plumbing checks + restart drill + fail-fast check as workflow steps (Task 4), tag/nightly cadence (Task 4 triggers).
- **Type consistency spot-checks:** `FeedEntry` (Task 7) consumed by Tasks 9/15; `PendingSend.targetDeviceId: string | null` (Task 12) mapped from `OutboxEntry.target_device_id?` (Task 11) in Task 13; `WorkerEvent`/`PopupRequest` shapes identical in Tasks 12/13/14/15; `Outbox.send(kind, body, targetDeviceId?)` signature (Task 11) called in Task 13 controller and menus (untargeted); `wsUrl` produced Task 13, asserted in its own tests; `SERVER_VERSION_KEY` written in onboarding (Task 17), read in Settings (Task 20); `applyAppearance` shared by Tasks 6/12/17/21; `DeviceView` shared by Tasks 7/8/15/20.
- **Known execution-time checks (flagged inline):** exact `createItem` target field name (Task 11 note); core engine's treatment of an empty-string cursor on sign-out (Task 13 note); Phase 1 JS CI job shape (Task 5 note); `appStatic.test.tsx` fold-in (Task 15 note).




