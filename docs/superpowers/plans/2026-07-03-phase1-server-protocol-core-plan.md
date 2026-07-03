# CrossClipper Phase 1 — Server + Protocol + Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working FastAPI server (auth, items, devices, WebSocket hub), an OpenAPI→TypeScript codegen pipeline, the `@crossclipper/core` sync engine with scenario tests, and a throwaway CLI that exercises the full loop end-to-end.

**Architecture:** Modular-monolith FastAPI server (modules: `auth`, `devices`, `items`, `realtime`) over SQLite via repository classes; the OpenAPI schema is the versioned contract (a pytest snapshot test pins it, `openapi-typescript` generates TS types from it); `@crossclipper/core` implements pull-based sync with a dumb WS nudge channel, a reconnecting socket, an item cache with dedup, and an offline outbox keyed by client-generated ULIDs.

**Tech Stack:** Python 3.12, uv, FastAPI, SQLAlchemy 2.0, pydantic-settings, bcrypt, python-ulid, pytest, httpx · TypeScript 5, npm workspaces, vitest, openapi-typescript, ulidx, Node 20+, `ws` (CLI only).

## Global Constraints

Every task's requirements implicitly include this section. Values copied from the spec (`docs/superpowers/specs/2026-07-03-cross-clipper-design.md`):

- Monorepo layout: `server/` (Python, uv), `packages/core/` (shared TS), `clients/` (CLI here), `docs/`.
- All REST endpoints under `/api/v1/`. WebSocket is a **notification channel only** — never a data channel. Sync source of truth is always `GET /items?cursor=<last-seen ULID>`.
- Item IDs are **ULIDs** (lexicographically sortable); sync cursor = `WHERE id > :cursor ORDER BY id`.
- **Soft delete with tombstones**; server prunes tombstones after `CC_TOMBSTONE_RETENTION_DAYS` (default `30`).
- `user_id` on every table from day one. `Blob` table exists but has **no endpoints** in Phase 1.
- Tokens: opaque, per-device, long-lived, **hashed at rest** (SHA-256), **constant-time comparison**. Revoking a device kills exactly that device's access.
- `POST /auth/register` open only while zero users exist; afterwards 403 unless `CC_ALLOW_REGISTRATION=true`.
- Login rate limiting. Item body size cap default **256 KB** (`CC_ITEM_MAX_BYTES=262144`) → 413. CORS restricted to configured origins (`CC_CORS_ORIGINS`, default none).
- Every error response is structured `{ "code": ..., "message": ... }`.
- All server config via `CC_*` env vars. `CC_SECRET_KEY` is the only required setting.
- Client-generated ULIDs double as **idempotency keys** — item POST retries are duplicate-safe.
- 401 → one re-auth surface, never a retry loop. WS reconnect uses **jittered exponential backoff**; always re-pull from cursor before trusting live events.
- Testing: **pytest** for server (contract tests against real temp SQLite, WS tests, OpenAPI snapshot test); **vitest** for core (reconnect scenarios, cursor gaps, outbox retries, dedup).
- TDD (superpowers:test-driven-development): write the failing test first, watch it fail, then implement.
- Conventional Commits; atomic commits; **PRs ≤ ~600 LOC soft cap** (source and tests counted separately; generated files exempt); PRs merged with merge commits.
- **Phase 1 exclusions:** blob/media endpoints (schema stub only), push relay and `POST /push/register`, multi-user registration UX, all GUI clients, Docker packaging (deferred to phase 2 alongside the extension).

## Workflow note (Diego's global workflow)

Execute in a git worktree off `main`. Commits are made locally per task as written below. **At each PR checkpoint: STOP, present the diff for Diego's review, and only push + open the PR after sign-off.** Merge with merge commits. Each PR branches from the merged result of the previous one (they are sequential, not parallel).

## Spec ambiguities resolved by this plan

Decisions made where the spec was silent or self-contradictory (flag to Diego at review; each is cheap to change):

1. **Item idempotency vs. §4 wire shape.** §4 shows `POST /items {kind, body}` but §8 requires client ULIDs as idempotency keys. Resolution: `POST /items` accepts an **optional client-supplied `id`** (validated ULID). Same `(user, id)` re-POST returns the existing item with `200` (vs `201` for new).
2. **`/health` location.** §4 lists it under `/api/v1/`, but §7's compose healthcheck curls bare `/health`. Resolution: served at **root `/health`** (matches the compose file, and it's unauthenticated infrastructure, not API surface).
3. **WS path.** Spec says `/ws?token=…`. Resolution: mounted at **`/api/v1/ws`** so the WS protocol is versioned with the REST contract.
4. **Tombstones in `GET /items`.** Resolution: requests **with a `cursor` include tombstones** (items with `deleted_at` set, `body` cleared to `""`); cold-start requests **without a cursor exclude them** (a fresh client has nothing to delete).
5. **Item kinds accepted in Phase 1.** Enum defines `text|link|image|file`, but `image`/`file` require blobs. Resolution: server **rejects `image`/`file` with 422 `unsupported_kind`** until the media phase.
6. **Client version signalling.** Mechanism unspecified. Resolution: optional **`X-Client-Version: x.y.z`** header; middleware compares against `CC_MIN_CLIENT_VERSION` (default `0.0.0`) and rejects with **426 `client_too_old`**. Missing/unparseable header passes (lenient).
7. **Migrations.** Not mentioned in spec. Resolution: `Base.metadata.create_all` for Phase 1; Alembic when the first schema *change* happens (before phase 2 ships to a real deployment).
8. **TS workspace tooling.** Unspecified. Resolution: **npm workspaces** (zero extra tooling). `@crossclipper/core` is consumed as TS source (`exports: ./src/index.ts`) — a build step comes with the first bundled client in phase 2.
9. **`POST /push/register`** is listed in §4 but push is phase 5 and no Phase 1 client can use it. Resolution: **not built** — adding it later is additive to the contract.
10. **Login rate limit numbers.** Unspecified. Resolution: in-memory sliding window, **10 attempts / 60 s per client IP** on `/auth/login` and `/auth/register` (separate buckets), 429 `rate_limited`.
11. **Token TTL.** "Long-lived" unspecified. Resolution: `CC_TOKEN_TTL_DAYS` default **365**.
12. **Timestamps** stored/serialized as naive UTC ISO-8601 (SQLite has no tz type); clients treat all times as UTC.

## PR sequence (10 PRs)

| PR | Branch | Title (conventional) | Tasks | Est. LOC (src/test) |
|----|--------|----------------------|-------|---------------------|
| 1 | `feat/server-skeleton` | `chore: scaffold monorepo and server skeleton with health endpoint` | 1–2 | ~300 / ~120 |
| 2 | `feat/server-auth` | `feat(server): auth module with registration lock, device tokens, rate limiting` | 3–4 | ~320 / ~220 |
| 3 | `feat/server-devices` | `feat(server): device list, rename and revoke endpoints` | 5 | ~120 / ~140 |
| 4 | `feat/server-items` | `feat(server): items feed with cursor sync, tombstones and size cap` | 6–7 | ~260 / ~280 |
| 5 | `feat/server-realtime` | `feat(server): websocket hub with live event broadcast` | 8–9 | ~160 / ~170 |
| 6 | `feat/api-contract` | `feat(contract): OpenAPI snapshot test and TypeScript codegen pipeline` | 10–11 | ~120 / ~60 (+generated) |
| 7 | `feat/core-client` | `feat(core): typed API client with structured errors` | 12 | ~180 / ~200 |
| 8 | `feat/core-sync` | `feat(core): sync engine with reconnect, cursor pulls and dedup` | 13–15 | ~330 / ~380 |
| 9 | `feat/core-outbox` | `feat(core): offline outbox with idempotent retries` | 16 | ~140 / ~200 |
| 10 | `feat/cli` | `feat(cli): throwaway CLI client for the end-to-end loop` | 17–18 | ~220 / manual |

## File structure (end state)

```
cross-clipper/
├── .gitignore                          # extended in Task 1
├── package.json                        # npm workspaces root (Task 11)
├── scripts/
│   └── update-api-contract.sh          # regen openapi.json + TS types (Task 10/11)
├── server/
│   ├── pyproject.toml                  # uv project (Task 1)
│   ├── scripts/dump_openapi.py         # canonical schema dump (Task 10)
│   ├── src/crossclipper/
│   │   ├── __init__.py
│   │   ├── main.py                     # create_app factory, router wiring, lifespan
│   │   ├── config.py                   # Settings (CC_* env)
│   │   ├── errors.py                   # AppError + {code,message} handlers
│   │   ├── protocol.py                 # client-version gate helpers
│   │   ├── health.py                   # GET /health
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── models.py               # User, Device, Item, Blob, AuthToken + utcnow
│   │   │   └── session.py              # engine init, get_session dependency
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   ├── router.py               # /auth/register, /auth/login
│   │   │   ├── service.py              # hashing, tokens, authenticate_token
│   │   │   ├── deps.py                 # require_auth → AuthContext
│   │   │   ├── ratelimit.py            # sliding-window RateLimiter
│   │   │   ├── repo.py                 # UserRepo, TokenRepo
│   │   │   └── schemas.py
│   │   ├── devices/
│   │   │   ├── __init__.py
│   │   │   ├── router.py               # GET/PATCH/DELETE /devices
│   │   │   ├── repo.py                 # DeviceRepo
│   │   │   └── schemas.py
│   │   ├── items/
│   │   │   ├── __init__.py
│   │   │   ├── router.py               # GET/POST/DELETE /items
│   │   │   ├── repo.py                 # ItemRepo (+ prune_tombstones)
│   │   │   └── schemas.py
│   │   └── realtime/
│   │       ├── __init__.py
│   │       ├── hub.py                  # in-memory per-user socket registry
│   │       └── router.py               # WS /api/v1/ws
│   └── tests/
│       ├── conftest.py
│       ├── helpers.py
│       ├── test_health.py
│       ├── test_db_schema.py
│       ├── test_auth.py
│       ├── test_ratelimit.py
│       ├── test_devices.py
│       ├── test_items_create.py
│       ├── test_items_sync.py
│       ├── test_realtime.py
│       └── test_openapi_contract.py
├── packages/core/
│   ├── package.json
│   ├── tsconfig.json
│   ├── openapi.json                    # committed contract (generated, exempt from LOC cap)
│   ├── src/
│   │   ├── index.ts
│   │   ├── generated/api.ts            # openapi-typescript output (generated)
│   │   ├── types.ts                    # Item/Device/... aliases over generated types
│   │   ├── storage.ts                  # SyncStorage interface + MemoryStorage
│   │   ├── api/client.ts               # ApiClient, ApiError, NetworkError
│   │   ├── cache.ts                    # ItemCache (dedup + tombstone-wins)
│   │   ├── sync/socket.ts              # WsLike, SocketFactory, ReconnectingSocket
│   │   ├── sync/engine.ts              # SyncEngine
│   │   └── outbox.ts                   # Outbox
│   └── tests/
│       ├── helpers.ts                  # FakeServer, FakeSocket, fakeUlid, tick
│       ├── client.test.ts
│       ├── cache.test.ts
│       ├── socket.test.ts
│       ├── engine.test.ts
│       └── outbox.test.ts
├── clients/cli/
│   ├── package.json
│   └── src/
│       ├── main.ts                     # login | send | feed | devices | listen
│       ├── storage.ts                  # FileStorage
│       └── ws.ts                       # node `ws` → WsLike adapter
└── docs/superpowers/…                  # specs and this plan
```

---

# PR 1 — Monorepo scaffold + server skeleton

## Task 1: Server project scaffold and settings

**Files:**
- Modify: `.gitignore`
- Create: `server/pyproject.toml`
- Create: `server/src/crossclipper/__init__.py`
- Create: `server/src/crossclipper/config.py`
- Test: `server/tests/test_config.py` *(temporary name — this file is small and stays)*

**Interfaces:**
- Produces: `Settings` (pydantic-settings, env prefix `CC_`) with fields `secret_key: str` (required), `data_dir: Path` (default `./data`), `allow_registration: bool = False`, `item_max_bytes: int = 262144`, `tombstone_retention_days: int = 30`, `token_ttl_days: int = 365`, `cors_origins: str = ""`, `min_client_version: str = "0.0.0"`; properties `blobs_dir -> Path`, `database_url -> str`, `cors_origin_list -> list[str]`.

- [ ] **Step 1: Scaffold the uv project**

```bash
cd /home/diego/projects/cross-clipper
mkdir -p server/src/crossclipper server/tests
```

Write `server/pyproject.toml`:

```toml
[project]
name = "crossclipper-server"
version = "0.1.0"
description = "CrossClipper self-hosted sync server"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy>=2.0",
    "pydantic-settings>=2.4",
    "bcrypt>=4.1",
    "python-ulid>=2.7",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "httpx>=0.27",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/crossclipper"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Write empty `server/src/crossclipper/__init__.py`.

Append to `.gitignore`:

```gitignore

# Python
.venv/
__pycache__/
*.egg-info/

# Node
node_modules/

# Local runtime data
data/
*.sqlite
```

Run: `cd server && uv sync`
Expected: resolves and installs; `uv run python -c "import crossclipper"` exits 0.

- [ ] **Step 2: Write the failing settings test**

`server/tests/test_config.py`:

```python
from pathlib import Path

from crossclipper.config import Settings


def test_settings_read_cc_env_vars(monkeypatch, tmp_path):
    monkeypatch.setenv("CC_SECRET_KEY", "s3cret")
    monkeypatch.setenv("CC_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CC_ITEM_MAX_BYTES", "1024")
    s = Settings()
    assert s.secret_key == "s3cret"
    assert s.data_dir == tmp_path
    assert s.item_max_bytes == 1024
    assert s.allow_registration is False
    assert s.tombstone_retention_days == 30
    assert s.token_ttl_days == 365


def test_settings_derived_paths_and_cors(tmp_path):
    s = Settings(secret_key="x", data_dir=tmp_path,
                 cors_origins="chrome-extension://abc, https://foo.example")
    assert s.blobs_dir == tmp_path / "blobs"
    assert s.database_url == f"sqlite:///{tmp_path / 'db.sqlite'}"
    assert s.cors_origin_list == ["chrome-extension://abc", "https://foo.example"]
    assert Settings(secret_key="x", data_dir=tmp_path).cors_origin_list == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crossclipper.config'`

- [ ] **Step 4: Implement `config.py`**

`server/src/crossclipper/config.py`:

```python
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All server configuration. Every field maps to a CC_* env var."""

    model_config = SettingsConfigDict(env_prefix="CC_")

    secret_key: str  # required; reserved for future signing use
    data_dir: Path = Path("./data")
    allow_registration: bool = False
    item_max_bytes: int = 262144  # 256 KB
    tombstone_retention_days: int = 30
    token_ttl_days: int = 365
    cors_origins: str = ""  # comma-separated origins
    min_client_version: str = "0.0.0"

    @property
    def blobs_dir(self) -> Path:
        return self.data_dir / "blobs"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'db.sqlite'}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/test_config.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add .gitignore server/
git commit -m "chore(server): scaffold uv project with CC_* settings"
```

## Task 2: Database schema, app factory, and /health

**Files:**
- Create: `server/src/crossclipper/db/__init__.py` (empty), `server/src/crossclipper/db/models.py`, `server/src/crossclipper/db/session.py`
- Create: `server/src/crossclipper/health.py`
- Create: `server/src/crossclipper/main.py`
- Create: `server/tests/conftest.py`, `server/tests/helpers.py` (stub)
- Test: `server/tests/test_db_schema.py`, `server/tests/test_health.py`

**Interfaces:**
- Produces: `create_app(settings: Settings | None = None) -> FastAPI` (app factory; `app.state.settings`, `app.state.engine` set); ORM classes `User, Device, Item, Blob, AuthToken`; `utcnow() -> datetime` (naive UTC); `init_db(engine)`; `get_session(request) -> Iterator[Session]` FastAPI dependency that commits on success; pytest fixtures `settings`, `app`, `client`.

- [ ] **Step 1: Write the failing tests**

`server/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(secret_key="test-secret", data_dir=tmp_path)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c
```

`server/tests/helpers.py` (grows in later tasks):

```python
"""Shared test helpers importable as `from helpers import ...`."""
```

`server/tests/test_db_schema.py`:

```python
from sqlalchemy import inspect

from crossclipper.db.models import utcnow


def test_all_five_tables_created(app):
    names = set(inspect(app.state.engine).get_table_names())
    assert {"users", "devices", "items", "blobs", "auth_tokens"} <= names


def test_utcnow_is_naive_utc():
    now = utcnow()
    assert now.tzinfo is None
```

`server/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_reports_unwritable_blob_dir(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    (tmp_path / "blobs").chmod(0o500)
    try:
        with TestClient(app) as c:
            r = c.get("/health")
        assert r.status_code == 503
        assert r.json()["code"] == "unhealthy"
    finally:
        (tmp_path / "blobs").chmod(0o700)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_db_schema.py tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crossclipper.main'`

- [ ] **Step 3: Implement models, session, health, app factory**

`server/src/crossclipper/db/models.py`:

```python
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    """Naive UTC timestamp — the one time format used everywhere."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    platform: Mapped[str] = mapped_column(String(16))  # ios|android|windows|extension|other
    push_token: Mapped[str | None] = mapped_column(String(512), default=None)
    push_transport: Mapped[str | None] = mapped_column(String(16), default=None)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)


class Item(Base):
    __tablename__ = "items"
    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    origin_device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"))
    kind: Mapped[str] = mapped_column(String(8))  # text|link|image|file
    body: Mapped[str] = mapped_column(Text)
    blob_id: Mapped[str | None] = mapped_column(ForeignKey("blobs.id"), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(default=None, index=True)


class Blob(Base):
    """Schema stub — no endpoints until the media phase."""

    __tablename__ = "blobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int]
    mime: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(512))
    thumb_key: Mapped[str | None] = mapped_column(String(512), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
```

`server/src/crossclipper/db/session.py`:

```python
from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from crossclipper.db.models import Base


def make_engine(database_url: str) -> Engine:
    return create_engine(database_url, connect_args={"check_same_thread": False})


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session
        session.commit()
```

`server/src/crossclipper/health.py`:

```python
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    settings = request.app.state.settings
    try:
        with request.app.state.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        probe = settings.blobs_dir / ".health-probe"
        probe.write_text("ok")
        probe.unlink()
    except Exception as exc:  # noqa: BLE001 — health must never 500
        return JSONResponse(status_code=503,
                            content={"code": "unhealthy", "message": str(exc)})
    return {"status": "ok"}
```

`server/src/crossclipper/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from crossclipper import health
from crossclipper.config import Settings
from crossclipper.db.session import init_db, make_engine


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.blobs_dir.mkdir(parents=True, exist_ok=True)

    engine = make_engine(settings.database_url)
    init_db(engine)

    app = FastAPI(title="CrossClipper", version="0.1.0")
    app.state.settings = settings
    app.state.engine = engine

    if settings.cors_origin_list:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list,
                           allow_methods=["*"], allow_headers=["*"])

    app.include_router(health.router)
    return app
```

Also write empty `server/src/crossclipper/db/__init__.py`.

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd server && uv run pytest -v`
Expected: all pass (config + schema + health)

- [ ] **Step 5: Sanity-boot the server**

Run: `cd server && CC_SECRET_KEY=dev CC_DATA_DIR=/tmp/cc-dev timeout 3 uv run uvicorn --factory crossclipper.main:create_app --port 8080; true`
Expected: uvicorn starts, logs "Application startup complete", then times out (that's the `timeout 3`).

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): add data model, app factory and /health endpoint"
```

### PR 1 checkpoint

- [ ] Run full suite: `cd server && uv run pytest -v` → all green.
- [ ] **STOP — present diff to Diego for review.** After sign-off: push branch, open PR `chore: scaffold monorepo and server skeleton with health endpoint`, monitor CI, merge with merge commit, clean up worktree branch.

---

# PR 2 — Auth module

## Task 3: Structured errors, client-version gate, and registration

**Files:**
- Create: `server/src/crossclipper/errors.py`, `server/src/crossclipper/protocol.py`
- Create: `server/src/crossclipper/auth/__init__.py` (empty), `server/src/crossclipper/auth/schemas.py`, `server/src/crossclipper/auth/repo.py`, `server/src/crossclipper/auth/service.py` (hashing only for now), `server/src/crossclipper/auth/router.py` (register only)
- Modify: `server/src/crossclipper/main.py` (error handlers, version middleware, auth router)
- Test: `server/tests/test_auth.py` (registration part)

**Interfaces:**
- Consumes: `create_app`, `get_session`, `User` (Task 2).
- Produces: `AppError(status: int, code: str, message: str)`; `register_error_handlers(app)`; `version_ok(client: str, minimum: str) -> bool`; `hash_password(pw: str) -> str`, `verify_password(pw: str, hashed: str) -> bool`; `UserRepo(session)` with `count() -> int`, `get_by_email(email) -> User | None`, `create(email, password_hash) -> User`; route `POST /api/v1/auth/register`.

- [ ] **Step 1: Write the failing tests**

`server/tests/test_auth.py`:

```python
from crossclipper.config import Settings
from crossclipper.main import create_app
from fastapi.testclient import TestClient


def test_first_registration_succeeds_then_locks(client):
    r = client.post("/api/v1/auth/register",
                    json={"email": "me@example.com", "password": "hunter22!"})
    assert r.status_code == 201
    assert "user_id" in r.json()

    r2 = client.post("/api/v1/auth/register",
                     json={"email": "two@example.com", "password": "hunter22!"})
    assert r2.status_code == 403
    assert r2.json() == {"code": "registration_closed",
                         "message": "registration is closed on this server"}


def test_allow_registration_flag_reopens(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path, allow_registration=True))
    with TestClient(app) as c:
        assert c.post("/api/v1/auth/register",
                      json={"email": "a@x.y", "password": "hunter22!"}).status_code == 201
        assert c.post("/api/v1/auth/register",
                      json={"email": "b@x.y", "password": "hunter22!"}).status_code == 201


def test_duplicate_email_conflicts(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path, allow_registration=True))
    with TestClient(app) as c:
        c.post("/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"})
        r = c.post("/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"})
    assert r.status_code == 409
    assert r.json()["code"] == "email_taken"


def test_validation_errors_use_structured_shape(client):
    r = client.post("/api/v1/auth/register", json={"email": "me@example.com"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "password" in body["message"]


def test_old_client_version_rejected(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path, min_client_version="1.0.0"))
    with TestClient(app) as c:
        r = c.get("/health", headers={"X-Client-Version": "0.9.0"})
        assert r.status_code == 426
        assert r.json()["code"] == "client_too_old"
        assert c.get("/health", headers={"X-Client-Version": "1.0.0"}).status_code == 200
        assert c.get("/health").status_code == 200  # no header → lenient
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_auth.py -v`
Expected: FAIL — 404s on `/api/v1/auth/register` and import errors.

- [ ] **Step 3: Implement errors, protocol, auth registration**

`server/src/crossclipper/errors.py`:

```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Every deliberate API error. Rendered as {code, message}."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status,
                            content={"code": exc.code, "message": exc.message})

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        message = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        return JSONResponse(status_code=422,
                            content={"code": "validation_error", "message": message})
```

`server/src/crossclipper/protocol.py`:

```python
def _parse(version: str) -> tuple[int, ...] | None:
    try:
        return tuple(int(p) for p in version.strip().split("."))
    except ValueError:
        return None


def version_ok(client: str, minimum: str) -> bool:
    """Lenient gate: unparseable versions pass; only a clearly-older client is refused."""
    c, m = _parse(client), _parse(minimum)
    if c is None or m is None:
        return True
    return c >= m
```

`server/src/crossclipper/auth/schemas.py`:

```python
from enum import Enum

from pydantic import BaseModel, Field


class Platform(str, Enum):
    ios = "ios"
    android = "android"
    windows = "windows"
    extension = "extension"
    other = "other"


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class RegisterOut(BaseModel):
    user_id: str


class LoginIn(BaseModel):
    email: str
    password: str
    device_name: str = Field(min_length=1, max_length=120)
    platform: Platform


class LoginOut(BaseModel):
    token: str
    device_id: str
```

`server/src/crossclipper/auth/repo.py`:

```python
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from crossclipper.db.models import AuthToken, User


class UserRepo:
    def __init__(self, session: Session):
        self.session = session

    def count(self) -> int:
        return self.session.scalar(select(func.count()).select_from(User)) or 0

    def get_by_email(self, email: str) -> User | None:
        return self.session.scalar(select(User).where(User.email == email))

    def create(self, email: str, password_hash: str) -> User:
        user = User(id=uuid4().hex, email=email, password_hash=password_hash)
        self.session.add(user)
        self.session.flush()
        return user


class TokenRepo:
    def __init__(self, session: Session):
        self.session = session

    def create(self, user_id: str, device_id: str, token_hash: str, expires_at) -> AuthToken:
        token = AuthToken(id=uuid4().hex, user_id=user_id, device_id=device_id,
                          token_hash=token_hash, expires_at=expires_at)
        self.session.add(token)
        self.session.flush()
        return token

    def get_by_hash(self, token_hash: str) -> AuthToken | None:
        return self.session.scalar(select(AuthToken).where(AuthToken.token_hash == token_hash))

    def delete_for_device(self, device_id: str) -> None:
        for row in self.session.scalars(select(AuthToken).where(AuthToken.device_id == device_id)):
            self.session.delete(row)
```

`server/src/crossclipper/auth/service.py` (password half; token half lands in Task 4):

```python
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False
```

`server/src/crossclipper/auth/router.py`:

```python
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from crossclipper.auth import service
from crossclipper.auth.repo import UserRepo
from crossclipper.auth.schemas import RegisterIn, RegisterOut
from crossclipper.db.session import get_session
from crossclipper.errors import AppError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=201, response_model=RegisterOut)
async def register(payload: RegisterIn, request: Request,
                   session: Session = Depends(get_session)) -> RegisterOut:
    repo = UserRepo(session)
    if repo.count() > 0 and not request.app.state.settings.allow_registration:
        raise AppError(403, "registration_closed", "registration is closed on this server")
    if repo.get_by_email(payload.email) is not None:
        raise AppError(409, "email_taken", "a user with this email already exists")
    user = repo.create(payload.email, service.hash_password(payload.password))
    return RegisterOut(user_id=user.id)
```

Modify `server/src/crossclipper/main.py` — add imports and wiring inside `create_app` (after `app.state.engine = engine`):

```python
from fastapi.responses import JSONResponse

from crossclipper.auth import router as auth_router
from crossclipper.errors import register_error_handlers
from crossclipper.protocol import version_ok

    # ... inside create_app, after app.state assignments:
    register_error_handlers(app)

    @app.middleware("http")
    async def client_version_gate(request, call_next):
        version = request.headers.get("x-client-version")
        minimum = request.app.state.settings.min_client_version
        if version and not version_ok(version, minimum):
            return JSONResponse(status_code=426, content={
                "code": "client_too_old",
                "message": f"minimum supported client version is {minimum}"})
        return await call_next(request)

    app.include_router(health.router)
    app.include_router(auth_router.router, prefix="/api/v1")
    return app
```

Write empty `server/src/crossclipper/auth/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/test_auth.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): add structured errors, client-version gate and first-run registration"
```

## Task 4: Login, device tokens, bearer auth, rate limiting

**Files:**
- Create: `server/src/crossclipper/auth/ratelimit.py`, `server/src/crossclipper/auth/deps.py`
- Create: `server/src/crossclipper/devices/__init__.py` (empty), `server/src/crossclipper/devices/repo.py` (create/get/touch only — list/rename/revoke come in Task 5)
- Modify: `server/src/crossclipper/auth/service.py`, `server/src/crossclipper/auth/router.py`, `server/src/crossclipper/main.py`
- Modify: `server/tests/helpers.py`
- Test: `server/tests/test_auth.py` (extend), `server/tests/test_ratelimit.py`

**Interfaces:**
- Consumes: `UserRepo`, `TokenRepo`, `verify_password`, `AppError`, `Device`, `utcnow`.
- Produces: `AuthContext(user_id: str, device_id: str)` dataclass; `authenticate_token(session: Session, raw_token: str) -> AuthContext | None`; dependency `require_auth(request, session) -> AuthContext`; `new_token() -> tuple[str, str]` (raw, sha256-hex hash); `hash_token(raw: str) -> str`; `RateLimiter(max_events: int, window_seconds: float, now=time.monotonic)` with `allow(key: str) -> bool`; `DeviceRepo(session)` with `create(user_id, name, platform) -> Device`, `get(user_id, device_id) -> Device | None`; route `POST /api/v1/auth/login`; test helpers `register_and_login(client, ...) -> (token, device_id)` and `auth_headers(token) -> dict`; `app.state.limiter` (`RateLimiter(10, 60)`).

- [ ] **Step 1: Write the failing tests**

Extend `server/tests/helpers.py`:

```python
"""Shared test helpers importable as `from helpers import ...`."""


def register_and_login(client, email="me@example.com", password="hunter22!",
                       device_name="test-device", platform="other"):
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code in (201, 403, 409)  # ok if user already exists
    r = client.post("/api/v1/auth/login", json={
        "email": email, "password": password,
        "device_name": device_name, "platform": platform})
    assert r.status_code == 200, r.text
    data = r.json()
    return data["token"], data["device_id"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}
```

Append to `server/tests/test_auth.py`:

```python
from helpers import auth_headers, register_and_login


def test_login_returns_token_and_device(client):
    token, device_id = register_and_login(client)
    assert len(token) > 30
    assert device_id


def test_login_wrong_password_401(client):
    register_and_login(client)
    r = client.post("/api/v1/auth/login", json={
        "email": "me@example.com", "password": "wrong-password",
        "device_name": "d", "platform": "other"})
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_credentials"


def test_tokens_are_hashed_at_rest(client, app):
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from crossclipper.db.models import AuthToken

    token, _ = register_and_login(client)
    with Session(app.state.engine) as session:
        rows = list(session.scalars(select(AuthToken)))
    assert len(rows) == 1
    assert rows[0].token_hash != token
    assert len(rows[0].token_hash) == 64  # sha256 hex


def test_protected_route_rejects_missing_and_bogus_tokens(client):
    # /api/v1/devices ships in Task 5; use it as the canonical protected route.
    assert client.get("/api/v1/devices").status_code == 401
    r = client.get("/api/v1/devices", headers=auth_headers("bogus"))
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"
```

*(The last test stays red until Task 5 adds `/devices`; to keep this task self-contained, it asserts against the auth failure only — a 404 route never reaches `require_auth`. So instead of `/devices`, mount a tiny probe: see Step 3, which wires `require_auth` into a temporary `GET /api/v1/auth/whoami` route that Task 5's real routes will supersede — the route is kept permanently as a cheap "is my token valid" check.)*

Replace that last test with:

```python
def test_whoami_roundtrip_and_rejections(client):
    token, device_id = register_and_login(client)
    r = client.get("/api/v1/auth/whoami", headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["device_id"] == device_id

    assert client.get("/api/v1/auth/whoami").status_code == 401
    r = client.get("/api/v1/auth/whoami", headers=auth_headers("bogus"))
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"
```

`server/tests/test_ratelimit.py`:

```python
from crossclipper.auth.ratelimit import RateLimiter
from helpers import register_and_login


def test_rate_limiter_sliding_window():
    clock = {"t": 0.0}
    rl = RateLimiter(max_events=3, window_seconds=10, now=lambda: clock["t"])
    assert all(rl.allow("k") for _ in range(3))
    assert rl.allow("k") is False
    assert rl.allow("other-key") is True  # keys are independent
    clock["t"] = 10.1
    assert rl.allow("k") is True  # window slid


def test_login_rate_limited_after_10_attempts(client):
    register_and_login(client)  # 1 successful login consumes 1 slot
    bad = {"email": "me@example.com", "password": "wrong-password",
           "device_name": "d", "platform": "other"}
    for _ in range(9):
        assert client.post("/api/v1/auth/login", json=bad).status_code == 401
    r = client.post("/api/v1/auth/login", json=bad)
    assert r.status_code == 429
    assert r.json()["code"] == "rate_limited"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_auth.py tests/test_ratelimit.py -v`
Expected: FAIL — no `/auth/login`, no `ratelimit` module.

- [ ] **Step 3: Implement**

`server/src/crossclipper/auth/ratelimit.py`:

```python
import time
from collections import defaultdict, deque
from collections.abc import Callable


class RateLimiter:
    """In-memory sliding window. Per-process is fine: one server process (§2)."""

    def __init__(self, max_events: int, window_seconds: float,
                 now: Callable[[], float] = time.monotonic):
        self.max_events = max_events
        self.window = window_seconds
        self._now = now
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        t = self._now()
        q = self._events[key]
        while q and q[0] <= t - self.window:
            q.popleft()
        if len(q) >= self.max_events:
            return False
        q.append(t)
        return True
```

Append to `server/src/crossclipper/auth/service.py`:

```python
import hashlib
import hmac
import secrets
from dataclasses import dataclass

from sqlalchemy.orm import Session

from crossclipper.db.models import Device, utcnow


def new_token() -> tuple[str, str]:
    """Returns (raw token for the client, sha256 hash for the DB)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    device_id: str


def authenticate_token(session: Session, raw_token: str) -> AuthContext | None:
    from crossclipper.auth.repo import TokenRepo  # local import avoids cycle

    candidate = hash_token(raw_token)
    row = TokenRepo(session).get_by_hash(candidate)
    if row is None or not hmac.compare_digest(row.token_hash, candidate):
        return None
    if row.expires_at <= utcnow():
        return None
    device = session.get(Device, row.device_id)
    if device is None or device.revoked_at is not None:
        return None
    device.last_seen_at = utcnow()
    return AuthContext(user_id=row.user_id, device_id=row.device_id)
```

`server/src/crossclipper/auth/deps.py`:

```python
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from crossclipper.auth.service import AuthContext, authenticate_token
from crossclipper.db.session import get_session
from crossclipper.errors import AppError


def rate_limit(request: Request, bucket: str) -> None:
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.limiter.allow(f"{bucket}:{ip}"):
        raise AppError(429, "rate_limited", "too many attempts; try again later")


async def require_auth(request: Request,
                       session: Session = Depends(get_session)) -> AuthContext:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise AppError(401, "invalid_token", "missing bearer token")
    ctx = authenticate_token(session, header[7:])
    if ctx is None:
        raise AppError(401, "invalid_token", "invalid, expired or revoked token")
    return ctx
```

`server/src/crossclipper/devices/repo.py` (plus empty `devices/__init__.py`):

```python
from uuid import uuid4

from sqlalchemy.orm import Session

from crossclipper.db.models import Device


class DeviceRepo:
    def __init__(self, session: Session):
        self.session = session

    def create(self, user_id: str, name: str, platform: str) -> Device:
        device = Device(id=uuid4().hex, user_id=user_id, name=name, platform=platform)
        self.session.add(device)
        self.session.flush()
        return device

    def get(self, user_id: str, device_id: str) -> Device | None:
        device = self.session.get(Device, device_id)
        if device is None or device.user_id != user_id:
            return None
        return device
```

Extend `server/src/crossclipper/auth/router.py` — add imports and two routes:

```python
from datetime import timedelta

from crossclipper.auth.deps import rate_limit, require_auth
from crossclipper.auth.schemas import LoginIn, LoginOut
from crossclipper.auth.service import AuthContext, new_token, verify_password
from crossclipper.auth.repo import TokenRepo
from crossclipper.devices.repo import DeviceRepo
from crossclipper.db.models import utcnow


@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn, request: Request,
                session: Session = Depends(get_session)) -> LoginOut:
    rate_limit(request, "login")
    user = UserRepo(session).get_by_email(payload.email)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AppError(401, "invalid_credentials", "email or password is incorrect")
    device = DeviceRepo(session).create(user.id, payload.device_name, payload.platform.value)
    raw, token_hash = new_token()
    ttl = timedelta(days=request.app.state.settings.token_ttl_days)
    TokenRepo(session).create(user.id, device.id, token_hash, utcnow() + ttl)
    return LoginOut(token=raw, device_id=device.id)


@router.get("/whoami")
async def whoami(ctx: AuthContext = Depends(require_auth)) -> dict:
    return {"user_id": ctx.user_id, "device_id": ctx.device_id}
```

Also add `rate_limit(request, "register")` as the first line of the `register` handler, and in `create_app` (main.py) add:

```python
from crossclipper.auth.ratelimit import RateLimiter

    app.state.limiter = RateLimiter(max_events=10, window_seconds=60)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): add login with device-scoped hashed tokens and rate limiting"
```

### PR 2 checkpoint

- [ ] `cd server && uv run pytest -v` → all green.
- [ ] **STOP — Diego review**, then push + PR `feat(server): auth module with registration lock, device tokens, rate limiting`.

---

# PR 3 — Devices module

## Task 5: Device list, rename, revoke

**Files:**
- Create: `server/src/crossclipper/devices/schemas.py`, `server/src/crossclipper/devices/router.py`
- Modify: `server/src/crossclipper/devices/repo.py` (add `list_active`, `rename`, `revoke`)
- Modify: `server/src/crossclipper/main.py` (mount router)
- Test: `server/tests/test_devices.py`

**Interfaces:**
- Consumes: `require_auth -> AuthContext`, `DeviceRepo`, `TokenRepo.delete_for_device`, `AppError`, `register_and_login`/`auth_headers` helpers.
- Produces: `GET /api/v1/devices -> DevicesOut{devices: list[DeviceOut]}`; `PATCH /api/v1/devices/{id} {name} -> DeviceOut`; `DELETE /api/v1/devices/{id} -> 204`; `DeviceOut{id, name, platform, last_seen_at, created_at}`; repo methods `list_active(user_id) -> list[Device]`, `rename(device, name)`, `revoke(device)`.

- [ ] **Step 1: Write the failing tests**

`server/tests/test_devices.py`:

```python
from helpers import auth_headers, register_and_login


def test_list_shows_logged_in_devices(client):
    token, device_id = register_and_login(client, device_name="laptop")
    register_and_login(client, device_name="phone")
    r = client.get("/api/v1/devices", headers=auth_headers(token))
    assert r.status_code == 200
    devices = r.json()["devices"]
    assert {d["name"] for d in devices} == {"laptop", "phone"}
    me = next(d for d in devices if d["id"] == device_id)
    assert me["platform"] == "other"
    assert me["last_seen_at"] and me["created_at"]


def test_rename_device(client):
    token, device_id = register_and_login(client)
    r = client.patch(f"/api/v1/devices/{device_id}",
                     json={"name": "renamed"}, headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"


def test_rename_unknown_device_404(client):
    token, _ = register_and_login(client)
    r = client.patch("/api/v1/devices/nope", json={"name": "x"},
                     headers=auth_headers(token))
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


def test_revoke_kills_exactly_that_devices_token(client):
    token_a, device_a = register_and_login(client, device_name="a")
    token_b, device_b = register_and_login(client, device_name="b")

    r = client.delete(f"/api/v1/devices/{device_b}", headers=auth_headers(token_a))
    assert r.status_code == 204
    # revoked device's token is dead...
    assert client.get("/api/v1/devices", headers=auth_headers(token_b)).status_code == 401
    # ...the other device is untouched, and the revoked one left the list
    r = client.get("/api/v1/devices", headers=auth_headers(token_a))
    assert r.status_code == 200
    assert [d["id"] for d in r.json()["devices"]] == [device_a]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_devices.py -v`
Expected: FAIL — 404 on `/api/v1/devices` (route missing).

- [ ] **Step 3: Implement**

Append to `server/src/crossclipper/devices/repo.py`:

```python
from sqlalchemy import select

from crossclipper.db.models import utcnow

    # methods on DeviceRepo:
    def list_active(self, user_id: str) -> list[Device]:
        stmt = (select(Device)
                .where(Device.user_id == user_id, Device.revoked_at.is_(None))
                .order_by(Device.created_at))
        return list(self.session.scalars(stmt))

    def rename(self, device: Device, name: str) -> Device:
        device.name = name
        return device

    def revoke(self, device: Device) -> None:
        device.revoked_at = utcnow()
```

`server/src/crossclipper/devices/schemas.py`:

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    platform: str
    last_seen_at: datetime
    created_at: datetime


class DevicesOut(BaseModel):
    devices: list[DeviceOut]


class DeviceRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
```

`server/src/crossclipper/devices/router.py`:

```python
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from crossclipper.auth.deps import require_auth
from crossclipper.auth.repo import TokenRepo
from crossclipper.auth.service import AuthContext
from crossclipper.db.session import get_session
from crossclipper.devices.repo import DeviceRepo
from crossclipper.devices.schemas import DeviceOut, DeviceRenameIn, DevicesOut
from crossclipper.errors import AppError

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=DevicesOut)
async def list_devices(ctx: AuthContext = Depends(require_auth),
                       session: Session = Depends(get_session)) -> DevicesOut:
    devices = DeviceRepo(session).list_active(ctx.user_id)
    return DevicesOut(devices=[DeviceOut.model_validate(d) for d in devices])


@router.patch("/{device_id}", response_model=DeviceOut)
async def rename_device(device_id: str, payload: DeviceRenameIn,
                        ctx: AuthContext = Depends(require_auth),
                        session: Session = Depends(get_session)) -> DeviceOut:
    repo = DeviceRepo(session)
    device = repo.get(ctx.user_id, device_id)
    if device is None or device.revoked_at is not None:
        raise AppError(404, "not_found", "device not found")
    return DeviceOut.model_validate(repo.rename(device, payload.name))


@router.delete("/{device_id}", status_code=204)
async def revoke_device(device_id: str,
                        ctx: AuthContext = Depends(require_auth),
                        session: Session = Depends(get_session)) -> Response:
    repo = DeviceRepo(session)
    device = repo.get(ctx.user_id, device_id)
    if device is None:
        raise AppError(404, "not_found", "device not found")
    repo.revoke(device)
    TokenRepo(session).delete_for_device(device.id)
    return Response(status_code=204)
```

In `create_app` (main.py) mount it next to the auth router:

```python
from crossclipper.devices import router as devices_router

    app.include_router(devices_router.router, prefix="/api/v1")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): add device list, rename and revoke endpoints"
```

### PR 3 checkpoint

- [ ] `cd server && uv run pytest -v` → all green.
- [ ] **STOP — Diego review**, then push + PR `feat(server): device list, rename and revoke endpoints`.

---

# PR 4 — Items module

## Task 6: Item creation — kinds, size cap, ULID idempotency

**Files:**
- Create: `server/src/crossclipper/items/__init__.py` (empty), `server/src/crossclipper/items/schemas.py`, `server/src/crossclipper/items/repo.py`, `server/src/crossclipper/items/router.py` (POST only)
- Modify: `server/src/crossclipper/main.py` (mount router)
- Test: `server/tests/test_items_create.py`

**Interfaces:**
- Consumes: `require_auth`, `get_session`, `AppError`, `Item`, `utcnow`.
- Produces: `POST /api/v1/items {kind, body, id?} -> ItemOut` (201 new / 200 idempotent replay); `ItemKind(str, Enum)` = `text|link|image|file`; `ItemIn{kind: ItemKind, body: str, id: str | None}`; `ItemOut{id, kind, body, origin_device_id, blob_id, created_at, deleted_at}` (from_attributes); `ItemsPage{items: list[ItemOut], next_cursor: str | None}`; `ItemRepo(session)` with `get(user_id, item_id) -> Item | None`, `create(id, user_id, origin_device_id, kind, body) -> Item`.

- [ ] **Step 1: Write the failing tests**

`server/tests/test_items_create.py`:

```python
from ulid import ULID

from helpers import auth_headers, register_and_login


def test_create_text_item(client):
    token, device_id = register_and_login(client)
    r = client.post("/api/v1/items", json={"kind": "text", "body": "hello"},
                    headers=auth_headers(token))
    assert r.status_code == 201
    item = r.json()
    assert item["kind"] == "text" and item["body"] == "hello"
    assert item["origin_device_id"] == device_id
    assert item["deleted_at"] is None and item["blob_id"] is None
    ULID.from_str(item["id"])  # server-minted id is a valid ULID


def test_client_supplied_ulid_is_idempotency_key(client):
    token, _ = register_and_login(client)
    item_id = str(ULID())
    payload = {"kind": "text", "body": "once", "id": item_id}
    r1 = client.post("/api/v1/items", json=payload, headers=auth_headers(token))
    r2 = client.post("/api/v1/items", json=payload, headers=auth_headers(token))
    assert r1.status_code == 201
    assert r2.status_code == 200  # replay, not duplicate
    assert r1.json()["id"] == r2.json()["id"] == item_id


def test_invalid_client_id_rejected(client):
    token, _ = register_and_login(client)
    r = client.post("/api/v1/items",
                    json={"kind": "text", "body": "x", "id": "not-a-ulid"},
                    headers=auth_headers(token))
    assert r.status_code == 422
    assert r.json()["code"] == "invalid_id"


def test_media_kinds_rejected_until_media_phase(client):
    token, _ = register_and_login(client)
    r = client.post("/api/v1/items", json={"kind": "image", "body": "cap"},
                    headers=auth_headers(token))
    assert r.status_code == 422
    assert r.json()["code"] == "unsupported_kind"


def test_body_over_256kb_rejected(client):
    token, _ = register_and_login(client)
    r = client.post("/api/v1/items",
                    json={"kind": "text", "body": "a" * (262144 + 1)},
                    headers=auth_headers(token))
    assert r.status_code == 413
    assert r.json()["code"] == "item_too_large"


def test_items_require_auth(client):
    assert client.post("/api/v1/items", json={"kind": "text", "body": "x"}).status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_items_create.py -v`
Expected: FAIL — 404 on `/api/v1/items`.

- [ ] **Step 3: Implement**

`server/src/crossclipper/items/schemas.py`:

```python
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class ItemKind(str, Enum):
    text = "text"
    link = "link"
    image = "image"  # defined day one (§3); rejected until the media phase
    file = "file"


class ItemIn(BaseModel):
    kind: ItemKind
    body: str
    id: str | None = None  # client-generated ULID; doubles as idempotency key


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: ItemKind
    body: str
    origin_device_id: str
    blob_id: str | None
    created_at: datetime
    deleted_at: datetime | None


class ItemsPage(BaseModel):
    items: list[ItemOut]
    next_cursor: str | None
```

`server/src/crossclipper/items/repo.py`:

```python
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from crossclipper.db.models import Item, utcnow


class ItemRepo:
    def __init__(self, session: Session):
        self.session = session

    def get(self, user_id: str, item_id: str) -> Item | None:
        item = self.session.get(Item, item_id)
        if item is None or item.user_id != user_id:
            return None
        return item

    def create(self, *, id: str, user_id: str, origin_device_id: str,
               kind: str, body: str) -> Item:
        item = Item(id=id, user_id=user_id, origin_device_id=origin_device_id,
                    kind=kind, body=body)
        self.session.add(item)
        self.session.flush()
        return item

    def list_page(self, user_id: str, *, cursor: str | None, origin: str | None,
                  limit: int, include_deleted: bool) -> tuple[list[Item], str | None]:
        stmt = (select(Item).where(Item.user_id == user_id)
                .order_by(Item.id).limit(limit + 1))
        if cursor:
            stmt = stmt.where(Item.id > cursor)
        if origin:
            stmt = stmt.where(Item.origin_device_id == origin)
        if not include_deleted:
            stmt = stmt.where(Item.deleted_at.is_(None))
        rows = list(self.session.scalars(stmt))
        if len(rows) > limit:
            return rows[:limit], rows[limit - 1].id
        return rows, None

    def soft_delete(self, item: Item) -> None:
        if item.deleted_at is None:
            item.deleted_at = utcnow()
            item.body = ""  # tombstones carry no content

    def prune_tombstones(self, cutoff: datetime) -> int:
        result = self.session.execute(
            delete(Item).where(Item.deleted_at.is_not(None), Item.deleted_at < cutoff))
        return result.rowcount
```

`server/src/crossclipper/items/router.py`:

```python
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session
from ulid import ULID

from crossclipper.auth.deps import require_auth
from crossclipper.auth.service import AuthContext
from crossclipper.db.session import get_session
from crossclipper.errors import AppError
from crossclipper.items.repo import ItemRepo
from crossclipper.items.schemas import ItemIn, ItemKind, ItemOut

router = APIRouter(prefix="/items", tags=["items"])

_SUPPORTED_KINDS = {ItemKind.text, ItemKind.link}


@router.post("", status_code=201, response_model=ItemOut)
async def create_item(payload: ItemIn, request: Request, response: Response,
                      ctx: AuthContext = Depends(require_auth),
                      session: Session = Depends(get_session)) -> ItemOut:
    if payload.kind not in _SUPPORTED_KINDS:
        raise AppError(422, "unsupported_kind",
                       f"kind '{payload.kind.value}' is not supported yet")
    max_bytes = request.app.state.settings.item_max_bytes
    if len(payload.body.encode("utf-8")) > max_bytes:
        raise AppError(413, "item_too_large", f"item body exceeds {max_bytes} bytes")

    repo = ItemRepo(session)
    if payload.id is not None:
        try:
            ULID.from_str(payload.id)
        except ValueError:
            raise AppError(422, "invalid_id", "item id must be a valid ULID")
        existing = repo.get(ctx.user_id, payload.id)
        if existing is not None:
            response.status_code = 200  # idempotent replay
            return ItemOut.model_validate(existing)

    item = repo.create(id=payload.id or str(ULID()), user_id=ctx.user_id,
                       origin_device_id=ctx.device_id,
                       kind=payload.kind.value, body=payload.body)
    return ItemOut.model_validate(item)
```

Mount in `create_app`:

```python
from crossclipper.items import router as items_router

    app.include_router(items_router.router, prefix="/api/v1")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/test_items_create.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): add item creation with size cap and ULID idempotency"
```

## Task 7: Item feed — cursor pagination, tombstones, delete, pruning

**Files:**
- Modify: `server/src/crossclipper/items/router.py` (add GET + DELETE)
- Modify: `server/src/crossclipper/main.py` (lifespan: prune at startup + daily loop)
- Test: `server/tests/test_items_sync.py`

**Interfaces:**
- Consumes: `ItemRepo.list_page`, `ItemRepo.soft_delete`, `ItemRepo.prune_tombstones`, `ItemsPage`.
- Produces: `GET /api/v1/items?cursor=&origin=&limit= -> ItemsPage`; `DELETE /api/v1/items/{id} -> 204`; lifespan wiring `prune_tombstones` on startup + every 24 h.

- [ ] **Step 1: Write the failing tests**

`server/tests/test_items_sync.py`:

```python
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from crossclipper.db.models import Item, utcnow
from helpers import auth_headers, register_and_login


def _post(client, token, body):
    r = client.post("/api/v1/items", json={"kind": "text", "body": body},
                    headers=auth_headers(token))
    assert r.status_code == 201
    return r.json()


def test_cursor_pagination_walks_the_feed_in_id_order(client):
    token, _ = register_and_login(client)
    ids = [_post(client, token, f"item-{n}")["id"] for n in range(3)]

    r = client.get("/api/v1/items?limit=2", headers=auth_headers(token))
    page = r.json()
    assert [i["id"] for i in page["items"]] == ids[:2]
    assert page["next_cursor"] == ids[1]

    r = client.get(f"/api/v1/items?cursor={page['next_cursor']}",
                   headers=auth_headers(token))
    page2 = r.json()
    assert [i["id"] for i in page2["items"]] == [ids[2]]
    assert page2["next_cursor"] is None


def test_origin_filter(client):
    token_a, device_a = register_and_login(client, device_name="a")
    token_b, device_b = register_and_login(client, device_name="b")
    _post(client, token_a, "from-a")
    _post(client, token_b, "from-b")

    r = client.get(f"/api/v1/items?origin={device_a}", headers=auth_headers(token_a))
    assert [i["body"] for i in r.json()["items"]] == ["from-a"]


def test_delete_produces_tombstone_visible_only_with_cursor(client):
    token, _ = register_and_login(client)
    first = _post(client, token, "keep")
    victim = _post(client, token, "secret")

    assert client.delete(f"/api/v1/items/{victim['id']}",
                         headers=auth_headers(token)).status_code == 204

    # cold start (no cursor): tombstone hidden
    cold = client.get("/api/v1/items", headers=auth_headers(token)).json()
    assert [i["id"] for i in cold["items"]] == [first["id"]]

    # incremental sync (with cursor): tombstone delivered, body scrubbed
    warm = client.get(f"/api/v1/items?cursor={first['id']}",
                      headers=auth_headers(token)).json()
    assert len(warm["items"]) == 1
    stone = warm["items"][0]
    assert stone["id"] == victim["id"]
    assert stone["deleted_at"] is not None
    assert stone["body"] == ""


def test_delete_is_idempotent_and_404s_on_unknown(client):
    token, _ = register_and_login(client)
    item = _post(client, token, "x")
    url = f"/api/v1/items/{item['id']}"
    assert client.delete(url, headers=auth_headers(token)).status_code == 204
    assert client.delete(url, headers=auth_headers(token)).status_code == 204
    r = client.delete("/api/v1/items/01JZZZZZZZZZZZZZZZZZZZZZZZ",
                      headers=auth_headers(token))
    assert r.status_code == 404


def test_prune_removes_only_expired_tombstones(client, app):
    token, _ = register_and_login(client)
    old = _post(client, token, "old")
    fresh = _post(client, token, "fresh")
    for item_id in (old["id"], fresh["id"]):
        client.delete(f"/api/v1/items/{item_id}", headers=auth_headers(token))

    from crossclipper.items.repo import ItemRepo

    with Session(app.state.engine) as session:
        session.get(Item, old["id"]).deleted_at = utcnow() - timedelta(days=40)
        pruned = ItemRepo(session).prune_tombstones(utcnow() - timedelta(days=30))
        session.commit()
    assert pruned == 1
    with Session(app.state.engine) as session:
        remaining = {i.id for i in session.scalars(select(Item))}
    assert old["id"] not in remaining and fresh["id"] in remaining
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_items_sync.py -v`
Expected: FAIL — `GET /api/v1/items` returns 405 (no GET route yet).

- [ ] **Step 3: Implement GET, DELETE, and prune wiring**

Append to `server/src/crossclipper/items/router.py`:

```python
from fastapi import Query

from crossclipper.items.schemas import ItemsPage


@router.get("", response_model=ItemsPage)
async def list_items(cursor: str | None = None, origin: str | None = None,
                     limit: int = Query(100, ge=1, le=500),
                     ctx: AuthContext = Depends(require_auth),
                     session: Session = Depends(get_session)) -> ItemsPage:
    items, next_cursor = ItemRepo(session).list_page(
        ctx.user_id, cursor=cursor, origin=origin, limit=limit,
        include_deleted=cursor is not None)
    return ItemsPage(items=[ItemOut.model_validate(i) for i in items],
                     next_cursor=next_cursor)


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: str,
                      ctx: AuthContext = Depends(require_auth),
                      session: Session = Depends(get_session)) -> Response:
    repo = ItemRepo(session)
    item = repo.get(ctx.user_id, item_id)
    if item is None:
        raise AppError(404, "not_found", "item not found")
    repo.soft_delete(item)
    return Response(status_code=204)
```

In `server/src/crossclipper/main.py`, add a lifespan and pass it to FastAPI:

```python
import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

from sqlalchemy.orm import Session

from crossclipper.db.models import utcnow
from crossclipper.items.repo import ItemRepo


def _prune(engine, settings) -> None:
    cutoff = utcnow() - timedelta(days=settings.tombstone_retention_days)
    with Session(engine) as session:
        ItemRepo(session).prune_tombstones(cutoff)
        session.commit()


@asynccontextmanager
async def _lifespan(app):
    _prune(app.state.engine, app.state.settings)

    async def daily():
        while True:
            await asyncio.sleep(24 * 3600)
            _prune(app.state.engine, app.state.settings)

    task = asyncio.create_task(daily())
    yield
    task.cancel()


# in create_app:
    app = FastAPI(title="CrossClipper", version="0.1.0", lifespan=_lifespan)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): add cursor-paginated feed, tombstoned delete and pruning"
```

### PR 4 checkpoint

- [ ] `cd server && uv run pytest -v` → all green.
- [ ] **STOP — Diego review**, then push + PR `feat(server): items feed with cursor sync, tombstones and size cap`.

---

# PR 5 — Realtime WebSocket hub

## Task 8: WS endpoint with token auth and keepalive

**Files:**
- Create: `server/src/crossclipper/realtime/__init__.py` (empty), `server/src/crossclipper/realtime/hub.py`, `server/src/crossclipper/realtime/router.py`
- Modify: `server/src/crossclipper/main.py` (create `app.state.hub`, mount WS router)
- Test: `server/tests/test_realtime.py`

**Interfaces:**
- Consumes: `authenticate_token(session, raw_token)`.
- Produces: `Hub` with `add(user_id, ws)`, `remove(user_id, ws)`, `async broadcast(user_id, event: dict)`; WS route `/api/v1/ws?token=…` (close code 4401 on bad token; replies `{"type": "pong"}` to `{"type": "ping"}`); `app.state.hub: Hub`.

- [ ] **Step 1: Write the failing tests**

`server/tests/test_realtime.py`:

```python
import pytest
from starlette.websockets import WebSocketDisconnect

from helpers import auth_headers, register_and_login


def test_ws_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws?token=bogus"):
            pass


def test_ws_ping_pong(client):
    token, _ = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_realtime.py -v`
Expected: FAIL — WS route missing (connect rejected for the wrong reason in test 1, test 2 errors).

- [ ] **Step 3: Implement hub and WS router**

`server/src/crossclipper/realtime/hub.py`:

```python
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    """In-memory per-user socket registry. One process, one hub (§2)."""

    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)

    def add(self, user_id: str, ws: WebSocket) -> None:
        self._sockets[user_id].add(ws)

    def remove(self, user_id: str, ws: WebSocket) -> None:
        self._sockets[user_id].discard(ws)

    async def broadcast(self, user_id: str, event: dict) -> None:
        for ws in list(self._sockets.get(user_id, ())):
            try:
                await ws.send_json(event)
            except Exception:  # noqa: BLE001 — a dead socket must not break the send
                self.remove(user_id, ws)
```

`server/src/crossclipper/realtime/router.py`:

```python
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from crossclipper.auth.service import authenticate_token

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(...)) -> None:
    with Session(websocket.app.state.engine) as session:
        ctx = authenticate_token(session, token)
        session.commit()  # persists last_seen_at touch
    if ctx is None:
        await websocket.close(code=4401)
        return

    hub = websocket.app.state.hub
    await websocket.accept()
    hub.add(ctx.user_id, websocket)
    try:
        while True:
            msg = await websocket.receive_json()
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(ctx.user_id, websocket)
```

In `create_app`:

```python
from crossclipper.realtime import router as realtime_router
from crossclipper.realtime.hub import Hub

    app.state.hub = Hub()
    app.include_router(realtime_router.router, prefix="/api/v1")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/test_realtime.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): add authenticated websocket endpoint with keepalive"
```

## Task 9: Broadcast live events from REST mutations

**Files:**
- Modify: `server/src/crossclipper/items/router.py` (broadcast `item_new`, `item_deleted`)
- Modify: `server/src/crossclipper/devices/router.py` (broadcast `device_changed` on rename/revoke)
- Modify: `server/src/crossclipper/auth/router.py` (broadcast `device_changed` on login)
- Test: `server/tests/test_realtime.py` (extend)

**Interfaces:**
- Consumes: `app.state.hub.broadcast`.
- Produces: WS events exactly per §4: `{"type": "item_new", "item": {…ItemOut…}}`, `{"type": "item_deleted", "item_id": "…"}`, `{"type": "device_changed"}`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_realtime.py`:

```python
def test_item_post_broadcasts_item_new(client):
    token, device_id = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        r = client.post("/api/v1/items", json={"kind": "text", "body": "hi"},
                        headers=auth_headers(token))
        assert r.status_code == 201
        event = ws.receive_json()
    assert event["type"] == "item_new"
    assert event["item"]["body"] == "hi"
    assert event["item"]["origin_device_id"] == device_id


def test_item_delete_broadcasts_item_deleted(client):
    token, _ = register_and_login(client)
    item = client.post("/api/v1/items", json={"kind": "text", "body": "x"},
                       headers=auth_headers(token)).json()
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        client.delete(f"/api/v1/items/{item['id']}", headers=auth_headers(token))
        assert ws.receive_json() == {"type": "item_deleted", "item_id": item["id"]}


def test_device_mutations_broadcast_device_changed(client):
    token, device_id = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        client.patch(f"/api/v1/devices/{device_id}", json={"name": "n"},
                     headers=auth_headers(token))
        assert ws.receive_json() == {"type": "device_changed"}
        register_and_login(client, device_name="second")  # login → new device
        assert ws.receive_json() == {"type": "device_changed"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/test_realtime.py -v`
Expected: new tests FAIL (no event ever arrives — `receive_json` raises on test-client timeout/close).

- [ ] **Step 3: Wire broadcasts into the mutation handlers**

Pattern (identical in all three routers): **commit the session first, then broadcast**, so a client reacting instantly to the event can already read the row.

`items/router.py` — end of `create_item`, replace the final `return`:

```python
    item = repo.create(id=payload.id or str(ULID()), user_id=ctx.user_id,
                       origin_device_id=ctx.device_id,
                       kind=payload.kind.value, body=payload.body)
    out = ItemOut.model_validate(item)
    session.commit()
    await request.app.state.hub.broadcast(
        ctx.user_id, {"type": "item_new", "item": out.model_dump(mode="json")})
    return out
```

`items/router.py` — `delete_item` gains a `request: Request` parameter; end becomes:

```python
    repo.soft_delete(item)
    session.commit()
    await request.app.state.hub.broadcast(
        ctx.user_id, {"type": "item_deleted", "item_id": item_id})
    return Response(status_code=204)
```

`devices/router.py` — `rename_device` and `revoke_device` gain `request: Request`; before their `return`:

```python
    session.commit()
    await request.app.state.hub.broadcast(ctx.user_id, {"type": "device_changed"})
```

`auth/router.py` — end of `login`, before `return LoginOut(...)`:

```python
    session.commit()
    await request.app.state.hub.broadcast(user.id, {"type": "device_changed"})
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `cd server && uv run pytest -v`
Expected: all pass (idempotent-replay POST returns before the broadcast block — verify `test_client_supplied_ulid_is_idempotency_key` still green).

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): broadcast item and device events over websocket"
```

### PR 5 checkpoint

- [ ] `cd server && uv run pytest -v` → all green.
- [ ] **STOP — Diego review**, then push + PR `feat(server): websocket hub with live event broadcast`.

---

# PR 6 — OpenAPI contract + TS codegen pipeline

## Task 10: OpenAPI snapshot test and dump script

**Files:**
- Create: `server/scripts/dump_openapi.py`
- Create: `scripts/update-api-contract.sh`
- Create: `packages/core/openapi.json` (generated by the script, committed)
- Test: `server/tests/test_openapi_contract.py`

**Interfaces:**
- Produces: committed contract file `packages/core/openapi.json`; regen entrypoint `scripts/update-api-contract.sh` (also regenerates TS types once Task 11 lands — the npm step is written now and is a no-op-safe `|| true` until then? **No** — see Step 3: the script only runs the npm step if the workspace exists, keeping this task independently green).

- [ ] **Step 1: Write the failing snapshot test**

`server/tests/test_openapi_contract.py`:

```python
import json
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[2] / "packages" / "core" / "openapi.json"
HINT = "OpenAPI contract drift — run scripts/update-api-contract.sh and commit the result"


def test_openapi_schema_matches_committed_contract(app):
    assert CONTRACT.exists(), f"missing {CONTRACT} — {HINT}"
    committed = json.loads(CONTRACT.read_text())
    assert app.openapi() == committed, HINT
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && uv run pytest tests/test_openapi_contract.py -v`
Expected: FAIL — `missing .../packages/core/openapi.json`

- [ ] **Step 3: Implement the dump script and generate the contract**

`server/scripts/dump_openapi.py`:

```python
"""Print the canonical OpenAPI schema to stdout. Deterministic: sorted keys."""

import json
import sys
import tempfile
from pathlib import Path

from crossclipper.config import Settings
from crossclipper.main import create_app


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(Settings(secret_key="schema-dump", data_dir=Path(tmp)))
        json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

`scripts/update-api-contract.sh`:

```bash
#!/usr/bin/env bash
# Regenerate the committed OpenAPI contract and (when present) the TS types.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p packages/core
(cd server && uv run python scripts/dump_openapi.py) > packages/core/openapi.json
echo "wrote packages/core/openapi.json"

if [ -f packages/core/package.json ]; then
  npm run generate --workspace @crossclipper/core
fi
```

Run:

```bash
chmod +x scripts/update-api-contract.sh
./scripts/update-api-contract.sh
```

Expected: `wrote packages/core/openapi.json`; file contains paths `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/devices`, `/api/v1/items`, `/health` (spot-check with `grep '"/api/v1/items"' packages/core/openapi.json`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && uv run pytest tests/test_openapi_contract.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/scripts scripts/ packages/core/openapi.json server/tests/test_openapi_contract.py
git commit -m "feat(contract): pin OpenAPI schema with snapshot test and dump script"
```

## Task 11: npm workspaces + `@crossclipper/core` scaffold with generated types

**Files:**
- Create: `package.json` (repo root), `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/generated/api.ts` (generated), `packages/core/src/types.ts`, `packages/core/src/index.ts`
- Test: `packages/core/tests/types.test.ts`

**Interfaces:**
- Produces: npm workspace root; `npm run generate --workspace @crossclipper/core` (openapi.json → `src/generated/api.ts`); type aliases `Item`, `Device`, `ItemsPage`, `LoginOut` in `packages/core/src/types.ts`:

```ts
import type { components } from "./generated/api";

export type Item = components["schemas"]["ItemOut"];
export type Device = components["schemas"]["DeviceOut"];
export type ItemsPage = components["schemas"]["ItemsPage"];
export type LoginOut = components["schemas"]["LoginOut"];
export type ItemKind = components["schemas"]["ItemKind"];
```

- [ ] **Step 1: Scaffold the workspace**

Root `package.json`:

```json
{
  "name": "crossclipper",
  "private": true,
  "workspaces": ["packages/*", "clients/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`packages/core/package.json`:

```json
{
  "name": "@crossclipper/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "generate": "openapi-typescript openapi.json -o src/generated/api.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ulidx": "^2.4.1"
  },
  "devDependencies": {
    "openapi-typescript": "^7.4.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

Run: `npm install` (repo root)
Expected: lockfile created, workspaces linked.

- [ ] **Step 2: Write the failing test**

`packages/core/tests/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Item, ItemsPage } from "../src/types";

describe("generated contract types", () => {
  it("Item shape matches the wire contract", () => {
    const item: Item = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      kind: "text",
      body: "hello",
      origin_device_id: "dev1",
      blob_id: null,
      created_at: "2026-07-03T10:00:00",
      deleted_at: null,
    };
    const page: ItemsPage = { items: [item], next_cursor: null };
    expect(page.items[0]?.id).toBe(item.id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — cannot resolve `../src/types` / `./generated/api`.

- [ ] **Step 4: Generate types and add the aliases**

```bash
npm run generate --workspace @crossclipper/core
```

Expected: `packages/core/src/generated/api.ts` created, containing `ItemOut`, `DeviceOut`, `ItemsPage`, `LoginOut` under `components["schemas"]`.

Create `packages/core/src/types.ts` with the alias block from the Interfaces section above, and `packages/core/src/index.ts`:

```ts
export * from "./types";
```

- [ ] **Step 5: Run test and typecheck to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: 1 passed; tsc clean. (Vitest does not typecheck — `tsc --noEmit` is the type gate; run both from here on.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/core
git commit -m "feat(core): scaffold workspace with generated OpenAPI types"
```

### PR 6 checkpoint

- [ ] `cd server && uv run pytest -v` and `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core` → all green.
- [ ] **STOP — Diego review**, then push + PR `feat(contract): OpenAPI snapshot test and TypeScript codegen pipeline`.

---

# PR 7 — Core: typed API client

## Task 12: `ApiClient` with structured errors and auth handling

**Files:**
- Create: `packages/core/src/api/client.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/client.test.ts`

**Interfaces:**
- Consumes: `Item`, `ItemsPage`, `Device`, `LoginOut`, `ItemKind` from `../types`.
- Produces (exact — later tasks and the CLI depend on these):

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string);
}
export class NetworkError extends Error {}

export interface ApiClientOptions {
  baseUrl: string;               // e.g. "http://localhost:8080", no trailing slash
  token?: string;
  clientVersion?: string;        // sent as X-Client-Version
  fetchFn?: typeof fetch;        // injected in tests
  onAuthFailure?: () => void;    // fired once per 401 response
}

export class ApiClient {
  constructor(opts: ApiClientOptions);
  setToken(token: string): void;
  register(email: string, password: string): Promise<{ user_id: string }>;
  login(input: { email: string; password: string; device_name: string; platform: string }): Promise<LoginOut>;
  listItems(params?: { cursor?: string; origin?: string; limit?: number }): Promise<ItemsPage>;
  createItem(input: { id?: string; kind: ItemKind; body: string }): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  listDevices(): Promise<{ devices: Device[] }>;
  renameDevice(id: string, name: string): Promise<Device>;
  revokeDevice(id: string): Promise<void>;
}
```

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { ApiClient, ApiError, NetworkError } from "../src/api/client";

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("ApiClient", () => {
  it("sends bearer token, client version and correct URL", async () => {
    const fetchFn = vi.fn(async () => json(200, { items: [], next_cursor: null }));
    const client = new ApiClient({
      baseUrl: "http://srv", token: "tok-1", clientVersion: "0.1.0",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.listItems({ cursor: "01A", limit: 50 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("http://srv/api/v1/items?cursor=01A&limit=50");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer tok-1");
    expect(headers.get("x-client-version")).toBe("0.1.0");
  });

  it("maps {code,message} error bodies to ApiError", async () => {
    const fetchFn = async () => json(413, { code: "item_too_large", message: "too big" });
    const client = new ApiClient({ baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch });
    const err = await client.createItem({ kind: "text", body: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(413);
    expect(err.code).toBe("item_too_large");
  });

  it("wraps transport failures in NetworkError", async () => {
    const fetchFn = async () => { throw new TypeError("fetch failed"); };
    const client = new ApiClient({ baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch });
    await expect(client.listItems()).rejects.toBeInstanceOf(NetworkError);
  });

  it("fires onAuthFailure on 401 and still throws", async () => {
    const onAuthFailure = vi.fn();
    const fetchFn = async () => json(401, { code: "invalid_token", message: "nope" });
    const client = new ApiClient({
      baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch, onAuthFailure,
    });
    await expect(client.listItems()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("handles 204 responses", async () => {
    const fetchFn = async () => new Response(null, { status: 204 });
    const client = new ApiClient({ baseUrl: "http://srv", fetchFn: fetchFn as typeof fetch });
    await expect(client.deleteItem("01A")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — cannot resolve `../src/api/client`.

- [ ] **Step 3: Implement the client**

`packages/core/src/api/client.ts`:

```ts
import type { Device, Item, ItemKind, ItemsPage, LoginOut } from "../types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  clientVersion?: string;
  fetchFn?: typeof fetch;
  onAuthFailure?: () => void;
}

export class ApiClient {
  private token: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.token = opts.token;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (this.opts.clientVersion) headers["x-client-version"] = this.opts.clientVersion;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
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
        /* non-JSON error body — keep defaults */
      }
      if (res.status === 401) this.opts.onAuthFailure?.();
      throw new ApiError(res.status, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  register(email: string, password: string): Promise<{ user_id: string }> {
    return this.request("POST", "/auth/register", { email, password });
  }

  login(input: { email: string; password: string; device_name: string; platform: string }): Promise<LoginOut> {
    return this.request("POST", "/auth/login", input);
  }

  listItems(params: { cursor?: string; origin?: string; limit?: number } = {}): Promise<ItemsPage> {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.origin) q.set("origin", params.origin);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request("GET", `/items${qs ? `?${qs}` : ""}`);
  }

  createItem(input: { id?: string; kind: ItemKind; body: string }): Promise<Item> {
    return this.request("POST", "/items", input);
  }

  deleteItem(id: string): Promise<void> {
    return this.request("DELETE", `/items/${id}`);
  }

  listDevices(): Promise<{ devices: Device[] }> {
    return this.request("GET", "/devices");
  }

  renameDevice(id: string, name: string): Promise<Device> {
    return this.request("PATCH", `/devices/${id}`, { name });
  }

  revokeDevice(id: string): Promise<void> {
    return this.request("DELETE", `/devices/${id}`);
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./api/client";
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add typed API client with structured error mapping"
```

### PR 7 checkpoint

- [ ] Full JS suite + typecheck green.
- [ ] **STOP — Diego review**, then push + PR `feat(core): typed API client with structured errors`.

---

# PR 8 — Core: sync engine

## Task 13: Storage interface and `ItemCache` with dedup + tombstone-wins

**Files:**
- Create: `packages/core/src/storage.ts`, `packages/core/src/cache.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/cache.test.ts`

**Interfaces:**
- Produces:

```ts
// storage.ts
export interface SyncStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
export class MemoryStorage implements SyncStorage { /* Map-backed */ }

// cache.ts
export class ItemCache {
  upsert(item: Item): boolean;                    // false if already known or tombstoned
  remove(id: string): boolean;                    // false if already tombstoned locally
  has(id: string): boolean;
  list(filter?: { origin?: string }): Item[];     // ascending by id (ULID = creation order)
}
```

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ItemCache } from "../src/cache";
import type { Item } from "../src/types";

const item = (id: string, origin = "dev1"): Item => ({
  id, kind: "text", body: `body-${id}`, origin_device_id: origin,
  blob_id: null, created_at: "2026-07-03T10:00:00", deleted_at: null,
});

describe("ItemCache", () => {
  it("dedups upserts by id", () => {
    const cache = new ItemCache();
    expect(cache.upsert(item("01B"))).toBe(true);
    expect(cache.upsert(item("01B"))).toBe(false); // duplicate delivery (WS + pull)
    expect(cache.list()).toHaveLength(1);
  });

  it("lists ascending by id with origin filter", () => {
    const cache = new ItemCache();
    cache.upsert(item("01C", "a"));
    cache.upsert(item("01B", "b"));
    expect(cache.list().map((i) => i.id)).toEqual(["01B", "01C"]);
    expect(cache.list({ origin: "a" }).map((i) => i.id)).toEqual(["01C"]);
  });

  it("remove is once-only and tombstone wins over late upsert", () => {
    const cache = new ItemCache();
    cache.upsert(item("01B"));
    expect(cache.remove("01B")).toBe(true);
    expect(cache.remove("01B")).toBe(false);        // repeated delete event
    expect(cache.upsert(item("01B"))).toBe(false);  // stale item_new after delete
    expect(cache.list()).toHaveLength(0);
  });

  it("remove of an unknown id still records the tombstone once", () => {
    const cache = new ItemCache();
    expect(cache.remove("01Z")).toBe(true);
    expect(cache.remove("01Z")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — cannot resolve `../src/cache`.

- [ ] **Step 3: Implement**

`packages/core/src/storage.ts`:

```ts
export interface SyncStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class MemoryStorage implements SyncStorage {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}
```

`packages/core/src/cache.ts`:

```ts
import type { Item } from "./types";

export class ItemCache {
  private readonly items = new Map<string, Item>();
  private readonly tombstones = new Set<string>();

  upsert(item: Item): boolean {
    if (this.tombstones.has(item.id)) return false; // deletion wins
    if (this.items.has(item.id)) return false;      // items are immutable in v1
    this.items.set(item.id, item);
    return true;
  }

  remove(id: string): boolean {
    if (this.tombstones.has(id)) return false;
    this.tombstones.add(id);
    this.items.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  list(filter?: { origin?: string }): Item[] {
    const all = [...this.items.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    return filter?.origin ? all.filter((i) => i.origin_device_id === filter.origin) : all;
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./storage";
export * from "./cache";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add item cache with dedup and tombstone-wins semantics"
```

## Task 14: `ReconnectingSocket` with jittered exponential backoff

**Files:**
- Create: `packages/core/src/sync/socket.ts`
- Create: `packages/core/tests/helpers.ts` (FakeSocket part; FakeServer added in Task 15)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/socket.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}
export type SocketFactory = (url: string) => WsLike;

export interface ReconnectOptions {
  baseMs?: number;   // default 1000
  maxMs?: number;    // default 30000
  random?: () => number; // default Math.random — jitter factor 0.5..1.0
}

export class ReconnectingSocket {
  onOpen: (() => void) | null;
  onMessage: ((msg: unknown) => void) | null;   // JSON-parsed
  onClose: (() => void) | null;
  constructor(urlFn: () => string, factory: SocketFactory, opts?: ReconnectOptions);
  start(): void;
  stop(): void;
  send(data: string): void;
}
```

- [ ] **Step 1: Write FakeSocket helper and the failing tests**

`packages/core/tests/helpers.ts` (initial version):

```ts
import type { WsLike } from "../src/sync/socket";

export class FakeSocket implements WsLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  // test-side controls
  serverOpen(): void {
    this.onopen?.();
  }

  serverSend(event: object): void {
    this.onmessage?.(JSON.stringify(event));
  }

  serverDrop(): void {
    this.onclose?.();
  }
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
```

`packages/core/tests/socket.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReconnectingSocket } from "../src/sync/socket";
import { FakeSocket } from "./helpers";

describe("ReconnectingSocket", () => {
  afterEach(() => vi.useRealTimers());

  it("reconnects with exponential backoff after drops", () => {
    vi.useFakeTimers();
    const created: FakeSocket[] = [];
    const factory = () => {
      const s = new FakeSocket();
      created.push(s);
      return s;
    };
    const rs = new ReconnectingSocket(() => "ws://x", factory,
      { baseMs: 1000, maxMs: 30000, random: () => 1 }); // jitter factor 1.0
    rs.start();
    expect(created).toHaveLength(1);

    created[0]!.serverOpen();
    created[0]!.serverDrop();               // attempt 0 → delay 1000
    vi.advanceTimersByTime(999);
    expect(created).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(created).toHaveLength(2);

    created[1]!.serverDrop();               // attempt 1 (never opened) → delay 2000
    vi.advanceTimersByTime(1999);
    expect(created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(created).toHaveLength(3);

    created[2]!.serverOpen();               // success resets attempt counter
    created[2]!.serverDrop();               // → delay back to 1000
    vi.advanceTimersByTime(1000);
    expect(created).toHaveLength(4);
    rs.stop();
  });

  it("stop() prevents further reconnects and closes the socket", () => {
    vi.useFakeTimers();
    const created: FakeSocket[] = [];
    const rs = new ReconnectingSocket(() => "ws://x",
      () => { const s = new FakeSocket(); created.push(s); return s; },
      { baseMs: 10, random: () => 1 });
    rs.start();
    rs.stop();
    expect(created[0]!.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(created).toHaveLength(1);
  });

  it("JSON-parses incoming messages and exposes send", () => {
    const created: FakeSocket[] = [];
    const rs = new ReconnectingSocket(() => "ws://x",
      () => { const s = new FakeSocket(); created.push(s); return s; });
    const seen: unknown[] = [];
    rs.onMessage = (m) => seen.push(m);
    rs.start();
    created[0]!.serverOpen();
    created[0]!.serverSend({ type: "pong" });
    rs.send('{"type":"ping"}');
    expect(seen).toEqual([{ type: "pong" }]);
    expect(created[0]!.sent).toEqual(['{"type":"ping"}']);
    rs.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — cannot resolve `../src/sync/socket`.

- [ ] **Step 3: Implement**

`packages/core/src/sync/socket.ts`:

```ts
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => WsLike;

export interface ReconnectOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

export class ReconnectingSocket {
  onOpen: (() => void) | null = null;
  onMessage: ((msg: unknown) => void) | null = null;
  onClose: (() => void) | null = null;

  private sock: WsLike | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly urlFn: () => string,
    private readonly factory: SocketFactory,
    private readonly opts: ReconnectOptions = {},
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.sock?.close();
    this.sock = null;
  }

  send(data: string): void {
    this.sock?.send(data);
  }

  private connect(): void {
    const sock = this.factory(this.urlFn());
    this.sock = sock;
    sock.onopen = () => {
      this.attempt = 0;
      this.onOpen?.();
    };
    sock.onmessage = (data) => {
      try {
        this.onMessage?.(JSON.parse(data));
      } catch {
        /* ignore malformed frames — WS is only a nudge channel */
      }
    };
    sock.onclose = () => {
      if (this.stopped) return;
      this.onClose?.();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const base = this.opts.baseMs ?? 1000;
    const max = this.opts.maxMs ?? 30000;
    const random = this.opts.random ?? Math.random;
    const delay = Math.min(max, base * 2 ** this.attempt) * (0.5 + random() * 0.5);
    this.attempt++;
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./sync/socket";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add reconnecting socket with jittered exponential backoff"
```

## Task 15: `SyncEngine` — pull-based sync with live nudges

**Files:**
- Create: `packages/core/src/sync/engine.ts`
- Modify: `packages/core/tests/helpers.ts` (add FakeServer, fakeUlid)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/engine.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `SyncStorage`, `ItemCache`, `ReconnectingSocket`, `SocketFactory`, `ReconnectOptions`.
- Produces (exact — the CLI depends on these):

```ts
export type SyncStatus = "stopped" | "connecting" | "syncing" | "live";

export type SyncEngineEvent =
  | { type: "item"; item: Item }
  | { type: "item_deleted"; itemId: string }
  | { type: "devices_changed" }
  | { type: "status"; status: SyncStatus };

export interface SyncEngineDeps {
  client: ApiClient;
  storage: SyncStorage;
  socketFactory: SocketFactory;
  wsUrl: () => string;             // full URL incl. ?token=
  backoff?: ReconnectOptions;
  pingIntervalMs?: number;         // default 30000
}

export class SyncEngine {
  readonly cache: ItemCache;
  constructor(deps: SyncEngineDeps);
  onEvent(cb: (e: SyncEngineEvent) => void): () => void;  // returns unsubscribe
  start(): Promise<void>;
  stop(): void;
}
```

Cursor rules (the reliability core, from §4/§8 of the spec):
- Cursor is persisted under storage key `"cc.cursor"` and **only advances from pulls**, never from WS events (WS broadcast order is not guaranteed to match ULID order; advancing on WS could skip a concurrently-created smaller ULID forever).
- On every socket open: status→`syncing`, buffer incoming WS events, pull all pages from the stored cursor, apply the buffer, status→`live`. Same single code path for cold start and reconnect.
- Failed pulls retry after `backoff.baseMs` (default 1000 ms) without leaving `syncing`.
- While `live`, sends `{"type":"ping"}` every `pingIntervalMs`.

- [ ] **Step 1: Extend helpers with FakeServer**

Append to `packages/core/tests/helpers.ts`:

```ts
import type { SocketFactory } from "../src/sync/socket";
import type { Item } from "../src/types";

export const fakeUlid = (n: number): string =>
  n.toString(36).toUpperCase().padStart(26, "0");

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export class FakeServer {
  items: Item[] = [];
  sockets: FakeSocket[] = [];
  autoOpen = true;
  listDelayMs = 0;
  failNextCreates = 0;                                   // throw TypeError n times
  rejectNextCreateWith: { status: number; code: string } | null = null;
  postAttempts = 0;
  private seq = 0;

  socketFactory: SocketFactory = () => {
    const s = new FakeSocket();
    this.sockets.push(s);
    if (this.autoOpen) queueMicrotask(() => s.serverOpen());
    return s;
  };

  lastSocket(): FakeSocket | undefined {
    return this.sockets[this.sockets.length - 1];
  }

  addItem(body: string, origin = "srv-dev"): Item {
    const item: Item = {
      id: fakeUlid(this.seq++), kind: "text", body, origin_device_id: origin,
      blob_id: null, created_at: "2026-07-03T10:00:00", deleted_at: null,
    };
    this.items.push(item);
    return item;
  }

  deleteItem(id: string): void {
    const it = this.items.find((i) => i.id === id);
    if (it) {
      it.deleted_at = "2026-07-03T11:00:00";
      it.body = "";
    }
  }

  broadcast(event: object): void {
    this.lastSocket()?.serverSend(event);
  }

  fetchFn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/api/v1/items" && method === "GET") {
      if (this.listDelayMs) await sleep(this.listDelayMs);
      const cursor = url.searchParams.get("cursor");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const rows = this.items
        .filter((i) => (cursor ? i.id > cursor : i.deleted_at === null))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const page = rows.slice(0, limit);
      const next = rows.length > limit ? page[page.length - 1]!.id : null;
      return json(200, { items: page, next_cursor: next });
    }

    if (url.pathname === "/api/v1/items" && method === "POST") {
      this.postAttempts++;
      if (this.failNextCreates > 0) {
        this.failNextCreates--;
        throw new TypeError("fetch failed");
      }
      if (this.rejectNextCreateWith) {
        const r = this.rejectNextCreateWith;
        this.rejectNextCreateWith = null;
        return json(r.status, { code: r.code, message: r.code });
      }
      const body = JSON.parse(String(init?.body)) as { id?: string; kind: "text" | "link"; body: string };
      const existing = this.items.find((i) => i.id === body.id);
      if (existing) return json(200, existing);
      const item: Item = {
        id: body.id ?? fakeUlid(this.seq++), kind: body.kind, body: body.body,
        origin_device_id: "cli-dev", blob_id: null,
        created_at: "2026-07-03T10:00:00", deleted_at: null,
      };
      this.items.push(item);
      return json(201, item);
    }

    return json(404, { code: "not_found", message: url.pathname });
  }) as typeof fetch;
}
```

- [ ] **Step 2: Write the failing scenario tests**

`packages/core/tests/engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ApiClient } from "../src/api/client";
import { MemoryStorage } from "../src/storage";
import { SyncEngine, type SyncEngineEvent } from "../src/sync/engine";
import { FakeServer, sleep, tick } from "./helpers";

function makeEngine(server: FakeServer, storage = new MemoryStorage()) {
  const engine = new SyncEngine({
    client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
    storage,
    socketFactory: server.socketFactory,
    wsUrl: () => "ws://test/api/v1/ws?token=t",
    backoff: { baseMs: 5, maxMs: 20, random: () => 1 },
    pingIntervalMs: 50,
  });
  const events: SyncEngineEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { engine, events, storage };
}

const bodies = (events: SyncEngineEvent[]) =>
  events.filter((e) => e.type === "item").map((e) => (e as { item: { body: string } }).item.body);

describe("SyncEngine scenarios", () => {
  it("cold start pulls all pages and persists the cursor", async () => {
    const server = new FakeServer();
    for (let n = 0; n < 5; n++) server.addItem(`item-${n}`);
    const last = server.items[server.items.length - 1]!;
    const { engine, events, storage } = makeEngine(server);

    await engine.start();
    await sleep(20);

    expect(bodies(events)).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
    expect(await storage.get("cc.cursor")).toBe(last.id);
    expect(events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status))
      .toEqual(["connecting", "syncing", "live"]);
    engine.stop();
  });

  it("live WS item_new events land in the cache", async () => {
    const server = new FakeServer();
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20); // reach live

    const item = server.addItem("pushed");
    server.broadcast({ type: "item_new", item });
    await tick();

    expect(bodies(events)).toEqual(["pushed"]);
    expect(engine.cache.has(item.id)).toBe(true);
    engine.stop();
  });

  it("recovers a cursor gap: items created while disconnected arrive via re-pull", async () => {
    const server = new FakeServer();
    server.addItem("before");
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20);

    server.lastSocket()!.serverDrop();          // connection lost
    server.addItem("missed-1");                 // server moves on without us
    server.addItem("missed-2");
    await sleep(30);                            // backoff (5ms) → reconnect → resync

    expect(bodies(events)).toEqual(["before", "missed-1", "missed-2"]);
    engine.stop();
  });

  it("dedups items delivered via both WS and pull", async () => {
    const server = new FakeServer();
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20);

    const item = server.addItem("dup");
    server.broadcast({ type: "item_new", item }); // live delivery
    await tick();
    server.lastSocket()!.serverDrop();            // reconnect → re-pull includes "dup"
    await sleep(30);

    expect(bodies(events)).toEqual(["dup"]);      // emitted exactly once
    engine.stop();
  });

  it("WS events received during a pull are buffered and applied after", async () => {
    const server = new FakeServer();
    server.listDelayMs = 20;
    server.addItem("pulled");
    const { engine, events } = makeEngine(server);
    await engine.start();
    await tick(); // socket open, pull in flight (delayed)

    const live = server.addItem("live-during-pull");
    server.broadcast({ type: "item_new", item: live });
    await sleep(40);

    expect(bodies(events)).toEqual(["pulled", "live-during-pull"]);
    engine.stop();
  });

  it("item_deleted removes from cache; devices_changed is surfaced", async () => {
    const server = new FakeServer();
    const item = server.addItem("gone");
    const { engine, events } = makeEngine(server);
    await engine.start();
    await sleep(20);

    server.broadcast({ type: "item_deleted", item_id: item.id });
    server.broadcast({ type: "device_changed" });
    await tick();

    expect(engine.cache.has(item.id)).toBe(false);
    expect(events.some((e) => e.type === "item_deleted")).toBe(true);
    expect(events.some((e) => e.type === "devices_changed")).toBe(true);
    engine.stop();
  });

  it("pulled tombstones delete from cache", async () => {
    const server = new FakeServer();
    const keep = server.addItem("keep");
    const victim = server.addItem("victim");
    const { engine, events, storage } = makeEngine(server);
    await engine.start();
    await sleep(20);

    server.lastSocket()!.serverDrop();
    server.deleteItem(victim.id);              // tombstoned while offline
    await sleep(30);

    expect(engine.cache.has(keep.id)).toBe(true);
    expect(engine.cache.has(victim.id)).toBe(false);
    expect(events.some((e) => e.type === "item_deleted"
      && (e as { itemId: string }).itemId === victim.id)).toBe(true);
    engine.stop();
  });

  it("sends keepalive pings while live", async () => {
    const server = new FakeServer();
    const { engine } = makeEngine(server);    // pingIntervalMs: 50
    await engine.start();
    await sleep(120);
    const pings = server.lastSocket()!.sent.filter((s) => s === '{"type":"ping"}');
    expect(pings.length).toBeGreaterThanOrEqual(2);
    engine.stop();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — cannot resolve `../src/sync/engine`.

- [ ] **Step 4: Implement the engine**

`packages/core/src/sync/engine.ts`:

```ts
import type { ApiClient } from "../api/client";
import { ItemCache } from "../cache";
import type { SyncStorage } from "../storage";
import { ReconnectingSocket, type ReconnectOptions, type SocketFactory } from "./socket";
import type { Item } from "../types";

const CURSOR_KEY = "cc.cursor";

export type SyncStatus = "stopped" | "connecting" | "syncing" | "live";

export type SyncEngineEvent =
  | { type: "item"; item: Item }
  | { type: "item_deleted"; itemId: string }
  | { type: "devices_changed" }
  | { type: "status"; status: SyncStatus };

type ServerEvent =
  | { type: "item_new"; item: Item }
  | { type: "item_deleted"; item_id: string }
  | { type: "device_changed" }
  | { type: "pong" };

export interface SyncEngineDeps {
  client: ApiClient;
  storage: SyncStorage;
  socketFactory: SocketFactory;
  wsUrl: () => string;
  backoff?: ReconnectOptions;
  pingIntervalMs?: number;
}

export class SyncEngine {
  readonly cache = new ItemCache();

  private cursor: string | null = null;
  private socket: ReconnectingSocket | null = null;
  private syncing = false;
  private buffer: ServerEvent[] = [];
  private listeners: Array<(e: SyncEngineEvent) => void> = [];
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(private readonly deps: SyncEngineDeps) {}

  onEvent(cb: (e: SyncEngineEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.cursor = await this.deps.storage.get(CURSOR_KEY);
    this.socket = new ReconnectingSocket(this.deps.wsUrl, this.deps.socketFactory,
      this.deps.backoff ?? {});
    this.socket.onOpen = () => void this.resync();
    this.socket.onMessage = (m) => this.handleMessage(m as ServerEvent);
    this.socket.onClose = () => {
      this.stopPing();
      this.emit({ type: "status", status: "connecting" });
    };
    this.emit({ type: "status", status: "connecting" });
    this.socket.start();
  }

  stop(): void {
    this.stopped = true;
    this.stopPing();
    clearTimeout(this.retryTimer);
    this.socket?.stop();
    this.socket = null;
    this.emit({ type: "status", status: "stopped" });
  }

  private emit(e: SyncEngineEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private handleMessage(e: ServerEvent): void {
    if (!e || e.type === "pong") return;
    if (this.syncing) {
      this.buffer.push(e);
    } else {
      this.apply(e);
    }
  }

  private apply(e: ServerEvent): void {
    if (e.type === "item_new") {
      // Cursor does NOT advance here — only pulls advance it (see plan §cursor rules).
      if (e.item.deleted_at) {
        if (this.cache.remove(e.item.id)) this.emit({ type: "item_deleted", itemId: e.item.id });
      } else if (this.cache.upsert(e.item)) {
        this.emit({ type: "item", item: e.item });
      }
    } else if (e.type === "item_deleted") {
      if (this.cache.remove(e.item_id)) this.emit({ type: "item_deleted", itemId: e.item_id });
    } else if (e.type === "device_changed") {
      this.emit({ type: "devices_changed" });
    }
  }

  private async resync(): Promise<void> {
    this.syncing = true;
    this.buffer = [];
    this.emit({ type: "status", status: "syncing" });
    try {
      await this.pull();
    } catch {
      if (this.stopped) return;
      this.retryTimer = setTimeout(() => void this.resync(),
        this.deps.backoff?.baseMs ?? 1000);
      return;
    }
    const buffered = this.buffer;
    this.buffer = [];
    this.syncing = false;
    for (const e of buffered) this.apply(e);
    this.startPing();
    this.emit({ type: "status", status: "live" });
  }

  private async pull(): Promise<void> {
    let cursor = this.cursor;
    for (;;) {
      const page = await this.deps.client.listItems({
        cursor: cursor ?? undefined, limit: 100 });
      for (const item of page.items) {
        if (item.deleted_at) {
          if (this.cache.remove(item.id)) this.emit({ type: "item_deleted", itemId: item.id });
        } else if (this.cache.upsert(item)) {
          this.emit({ type: "item", item });
        }
      }
      const lastItem = page.items[page.items.length - 1];
      if (lastItem) cursor = lastItem.id;
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      if (cursor) await this.deps.storage.set(CURSOR_KEY, cursor);
    }
  }

  private startPing(): void {
    this.stopPing();
    const interval = this.deps.pingIntervalMs ?? 30000;
    this.pingTimer = setInterval(() => this.socket?.send('{"type":"ping"}'), interval);
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./sync/engine";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: all scenarios pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add sync engine with cursor pulls, reconnect and dedup"
```

### PR 8 checkpoint

- [ ] Full JS suite + typecheck green; `cd server && uv run pytest -v` still green.
- [ ] **STOP — Diego review**, then push + PR `feat(core): sync engine with reconnect, cursor pulls and dedup`.

---

# PR 9 — Core: offline outbox

## Task 16: `Outbox` with persistent, idempotent retries

**Files:**
- Create: `packages/core/src/outbox.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/outbox.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `ApiError`, `NetworkError`, `SyncStorage`, `Item`; `ulid()` from `ulidx`.
- Produces (exact — the CLI depends on these):

```ts
export interface OutboxEntry {
  id: string;                 // client-generated ULID = idempotency key
  kind: "text" | "link";
  body: string;
  attempts: number;
}

export type OutboxEvent =
  | { type: "delivered"; item: Item }
  | { type: "rejected"; entry: OutboxEntry; error: ApiError }   // 4xx (except 401): dropped
  | { type: "auth_required" };                                  // 401: entry kept, flushing halted

export interface OutboxDeps {
  client: ApiClient;
  storage: SyncStorage;
  onEvent?: (e: OutboxEvent) => void;
  ulidFn?: () => string;      // injected in tests
  baseMs?: number;            // retry backoff base, default 1000
  maxMs?: number;             // retry backoff cap, default 30000
}

export class Outbox {
  constructor(deps: OutboxDeps);
  load(): Promise<void>;                              // hydrate from storage key "cc.outbox"
  pending(): OutboxEntry[];
  send(kind: "text" | "link", body: string): Promise<string>;  // returns the ULID
  flush(): Promise<void>;
  stop(): void;                                       // cancel pending retry timer
}
```

Retry policy: `NetworkError` and `ApiError` with status ≥ 500 → keep entry, increment `attempts`, retry after `min(maxMs, baseMs * 2^(attempts-1))`. `ApiError` 401 → keep entry, emit `auth_required`, stop (no retry loop — spec §8). Other 4xx → drop entry, emit `rejected`. Delivery is serial and FIFO. The server treats a re-POST of the same ULID as a replay (200), so a retry after a lost response is duplicate-safe.

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/outbox.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ApiClient } from "../src/api/client";
import { Outbox, type OutboxEvent } from "../src/outbox";
import { MemoryStorage } from "../src/storage";
import { FakeServer, sleep } from "./helpers";

function makeOutbox(server: FakeServer, storage = new MemoryStorage()) {
  const events: OutboxEvent[] = [];
  const outbox = new Outbox({
    client: new ApiClient({ baseUrl: "http://test", fetchFn: server.fetchFn }),
    storage,
    onEvent: (e) => events.push(e),
    baseMs: 5,
    maxMs: 20,
  });
  return { outbox, events, storage };
}

describe("Outbox", () => {
  it("delivers immediately when online", async () => {
    const server = new FakeServer();
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    const id = await outbox.send("text", "hello");
    await sleep(20);

    expect(server.items.map((i) => i.id)).toEqual([id]);
    expect(events).toEqual([{ type: "delivered", item: server.items[0] }]);
    expect(outbox.pending()).toEqual([]);
  });

  it("retries network failures with backoff, reusing the same ULID", async () => {
    const server = new FakeServer();
    server.failNextCreates = 2;
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    const id = await outbox.send("text", "flaky");
    await sleep(80); // 2 failures (5ms, 10ms backoff) then success

    expect(server.postAttempts).toBe(3);
    expect(server.items.map((i) => i.id)).toEqual([id]); // delivered exactly once
    expect(events.at(-1)).toEqual({ type: "delivered", item: server.items[0] });
    expect(outbox.pending()).toEqual([]);
    outbox.stop();
  });

  it("drops and reports validation rejections without retrying", async () => {
    const server = new FakeServer();
    server.rejectNextCreateWith = { status: 413, code: "item_too_large" };
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    await outbox.send("text", "huge");
    await sleep(20);

    expect(server.items).toEqual([]);
    expect(events[0]?.type).toBe("rejected");
    expect(outbox.pending()).toEqual([]);
    expect(server.postAttempts).toBe(1); // no retry loop
  });

  it("keeps the entry and halts on 401", async () => {
    const server = new FakeServer();
    server.rejectNextCreateWith = { status: 401, code: "invalid_token" };
    const { outbox, events } = makeOutbox(server);
    await outbox.load();
    await outbox.send("text", "queued");
    await sleep(30);

    expect(events).toContainEqual({ type: "auth_required" });
    expect(outbox.pending()).toHaveLength(1); // survives for after re-auth
    expect(server.postAttempts).toBe(1);      // exactly one attempt, no hammering
  });

  it("persists queue across restarts and delivers FIFO", async () => {
    const server = new FakeServer();
    server.failNextCreates = 100; // fully offline
    const storage = new MemoryStorage();
    const first = makeOutbox(server, storage);
    await first.outbox.load();
    await first.outbox.send("text", "one");
    await first.outbox.send("text", "two");
    first.outbox.stop();

    server.failNextCreates = 0; // back online; simulate app restart
    const second = makeOutbox(server, storage);
    await second.outbox.load();
    expect(second.outbox.pending()).toHaveLength(2);
    await second.outbox.flush();
    await sleep(20);

    expect(server.items.map((i) => i.body)).toEqual(["one", "two"]);
    expect(second.outbox.pending()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @crossclipper/core`
Expected: FAIL — cannot resolve `../src/outbox`.

- [ ] **Step 3: Implement**

`packages/core/src/outbox.ts`:

```ts
import { ulid } from "ulidx";

import { ApiError, NetworkError, type ApiClient } from "./api/client";
import type { SyncStorage } from "./storage";
import type { Item } from "./types";

const OUTBOX_KEY = "cc.outbox";

export interface OutboxEntry {
  id: string;
  kind: "text" | "link";
  body: string;
  attempts: number;
}

export type OutboxEvent =
  | { type: "delivered"; item: Item }
  | { type: "rejected"; entry: OutboxEntry; error: ApiError }
  | { type: "auth_required" };

export interface OutboxDeps {
  client: ApiClient;
  storage: SyncStorage;
  onEvent?: (e: OutboxEvent) => void;
  ulidFn?: () => string;
  baseMs?: number;
  maxMs?: number;
}

export class Outbox {
  private entries: OutboxEntry[] = [];
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly deps: OutboxDeps) {}

  async load(): Promise<void> {
    const raw = await this.deps.storage.get(OUTBOX_KEY);
    this.entries = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  }

  pending(): OutboxEntry[] {
    return [...this.entries];
  }

  async send(kind: "text" | "link", body: string): Promise<string> {
    const id = (this.deps.ulidFn ?? ulid)();
    this.entries.push({ id, kind, body, attempts: 0 });
    await this.persist();
    void this.flush();
    return id;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    try {
      while (this.entries.length > 0 && !this.stopped) {
        const entry = this.entries[0]!;
        try {
          const item = await this.deps.client.createItem(
            { id: entry.id, kind: entry.kind, body: entry.body });
          this.entries.shift();
          await this.persist();
          this.deps.onEvent?.({ type: "delivered", item });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            this.deps.onEvent?.({ type: "auth_required" });
            return; // entry kept; caller re-auths, then calls flush() again
          }
          if (err instanceof ApiError && err.status < 500) {
            this.entries.shift();
            await this.persist();
            this.deps.onEvent?.({ type: "rejected", entry, error: err });
            continue;
          }
          if (err instanceof NetworkError || err instanceof ApiError) {
            entry.attempts++;
            await this.persist();
            this.scheduleRetry(entry.attempts);
            return;
          }
          throw err; // programmer error — never swallow
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry(attempts: number): void {
    if (this.stopped) return;
    const base = this.deps.baseMs ?? 1000;
    const max = this.deps.maxMs ?? 30000;
    const delay = Math.min(max, base * 2 ** (attempts - 1));
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), delay);
  }

  private async persist(): Promise<void> {
    await this.deps.storage.set(OUTBOX_KEY, JSON.stringify(this.entries));
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./outbox";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @crossclipper/core && npm run typecheck --workspace @crossclipper/core`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add offline outbox with idempotent retries"
```

### PR 9 checkpoint

- [ ] Full JS suite + typecheck green.
- [ ] **STOP — Diego review**, then push + PR `feat(core): offline outbox with idempotent retries`.

---

# PR 10 — Throwaway CLI + end-to-end loop

## Task 17: CLI client

The CLI is explicitly throwaway (§10): it exists to exercise `@crossclipper/core` against the real server. No unit tests — its verification is the end-to-end smoke in Task 18. Keep it a dumb argv switch; no CLI framework.

**Files:**
- Create: `clients/cli/package.json`, `clients/cli/src/storage.ts`, `clients/cli/src/ws.ts`, `clients/cli/src/main.ts`

**Interfaces:**
- Consumes: `ApiClient`, `SyncEngine`, `Outbox`, `SyncStorage`, `SocketFactory`, `WsLike` from `@crossclipper/core`.
- Produces: `npm run cli --workspace @crossclipper/cli -- <command>` with commands `login <serverUrl> <email> <password> [deviceName]`, `send <text…>`, `feed`, `devices`, `listen`. State in `$CC_CLI_DIR` (default `~/.crossclipper-cli`): `config.json` `{baseUrl, token, deviceId}` + `state.json` (cursor/outbox via `FileStorage`).

- [ ] **Step 1: Scaffold the package**

`clients/cli/package.json`:

```json
{
  "name": "@crossclipper/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "cli": "tsx src/main.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@crossclipper/core": "*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

`clients/cli/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Run: `npm install` (root)
Expected: workspace links `@crossclipper/core`.

- [ ] **Step 2: Implement the adapters**

`clients/cli/src/storage.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

import type { SyncStorage } from "@crossclipper/core";

export class FileStorage implements SyncStorage {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async get(key: string): Promise<string | null> {
    return (await this.read())[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const data = await this.read();
    data[key] = value;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
```

`clients/cli/src/ws.ts`:

```ts
import WebSocket from "ws";

import type { SocketFactory, WsLike } from "@crossclipper/core";

export const nodeSocketFactory: SocketFactory = (url: string): WsLike => {
  const sock = new WebSocket(url);
  const like: WsLike = {
    send: (data) => sock.send(data),
    close: () => sock.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  sock.on("open", () => like.onopen?.());
  sock.on("message", (data) => like.onmessage?.(data.toString()));
  sock.on("close", () => like.onclose?.());
  sock.on("error", () => { /* close event follows; reconnect handles it */ });
  return like;
};
```

- [ ] **Step 3: Implement the command switch**

`clients/cli/src/main.ts`:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { ApiClient, ApiError, Outbox, SyncEngine } from "@crossclipper/core";

import { FileStorage } from "./storage.js";
import { nodeSocketFactory } from "./ws.js";

const VERSION = "0.1.0";
const dir = process.env.CC_CLI_DIR ?? path.join(os.homedir(), ".crossclipper-cli");
const configPath = path.join(dir, "config.json");
const statePath = path.join(dir, "state.json");

interface Config { baseUrl: string; token: string; deviceId: string }

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await fs.readFile(configPath, "utf8")) as Config;
  } catch {
    console.error("not logged in — run: cli login <serverUrl> <email> <password> [deviceName]");
    process.exit(1);
  }
}

function makeClient(cfg: Config): ApiClient {
  return new ApiClient({
    baseUrl: cfg.baseUrl, token: cfg.token, clientVersion: VERSION,
    onAuthFailure: () => console.error("auth failed — token revoked or expired; run login again"),
  });
}

const wsUrl = (cfg: Config) =>
  `${cfg.baseUrl.replace(/^http/, "ws")}/api/v1/ws?token=${encodeURIComponent(cfg.token)}`;

const [cmd = "help", ...args] = process.argv.slice(2);

if (cmd === "login") {
  const [baseUrl, email, password, deviceName] = args;
  if (!baseUrl || !email || !password) {
    console.error("usage: cli login <serverUrl> <email> <password> [deviceName]");
    process.exit(1);
  }
  if (!/^https:/.test(baseUrl) && !/localhost|127\.0\.0\.1|^http:\/\/192\.168\./.test(baseUrl)) {
    console.error("WARNING: non-local http:// URL — your token and items travel in cleartext (spec §5)");
  }
  const client = new ApiClient({ baseUrl, clientVersion: VERSION });
  try {
    await client.register(email, password);
    console.log("registered new user (first run)");
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "registration_closed")) throw err;
  }
  const res = await client.login({
    email, password, device_name: deviceName ?? os.hostname(), platform: "other" });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath,
    JSON.stringify({ baseUrl, token: res.token, deviceId: res.device_id }, null, 2));
  console.log(`logged in — device ${res.device_id}`);
} else if (cmd === "send") {
  const body = args.join(" ");
  if (!body) { console.error("usage: cli send <text>"); process.exit(1); }
  const cfg = await loadConfig();
  const outbox = new Outbox({
    client: makeClient(cfg),
    storage: new FileStorage(statePath),
    onEvent: (e) => {
      if (e.type === "delivered") { console.log(`delivered ${e.item.id}`); process.exit(0); }
      if (e.type === "rejected") { console.error(`rejected: ${e.error.code}`); process.exit(1); }
      if (e.type === "auth_required") { console.error("auth required — run login again"); process.exit(1); }
    },
  });
  await outbox.load();
  await outbox.send("text", body);
  await outbox.flush(); // retries keep the process alive until delivered/rejected
} else if (cmd === "feed") {
  const cfg = await loadConfig();
  const client = makeClient(cfg);
  let cursor: string | undefined;
  for (;;) {
    const page = await client.listItems({ cursor });
    for (const item of page.items) {
      if (!item.deleted_at) console.log(`${item.id}  [${item.origin_device_id}]  ${item.body}`);
    }
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
} else if (cmd === "devices") {
  const cfg = await loadConfig();
  const { devices } = await makeClient(cfg).listDevices();
  for (const d of devices) {
    const me = d.id === cfg.deviceId ? " (this device)" : "";
    console.log(`${d.id}  ${d.platform.padEnd(9)}  ${d.name}${me}  last seen ${d.last_seen_at}`);
  }
} else if (cmd === "listen") {
  const cfg = await loadConfig();
  const engine = new SyncEngine({
    client: makeClient(cfg),
    storage: new FileStorage(statePath),
    socketFactory: nodeSocketFactory,
    wsUrl: () => wsUrl(cfg),
  });
  engine.onEvent((e) => {
    if (e.type === "item") console.log(`[${e.item.origin_device_id}] ${e.item.body}`);
    else if (e.type === "item_deleted") console.log(`(deleted ${e.itemId})`);
    else if (e.type === "devices_changed") console.log("(device list changed)");
    else console.log(`-- ${e.status}`);
  });
  await engine.start();
  console.log("listening — Ctrl-C to quit");
} else {
  console.log(`crossclipper cli ${VERSION}
usage:
  cli login <serverUrl> <email> <password> [deviceName]
  cli send <text...>
  cli feed
  cli devices
  cli listen`);
}
```

- [ ] **Step 4: Verify it typechecks and prints usage**

Run: `npm install && npm run typecheck --workspace @crossclipper/cli && npm run cli --workspace @crossclipper/cli -- help`
Expected: tsc clean; usage text printed.

- [ ] **Step 5: Commit**

```bash
git add clients/cli package.json package-lock.json
git commit -m "feat(cli): add throwaway CLI client using @crossclipper/core"
```

## Task 18: End-to-end smoke of the whole loop

No new code — this is the phase's exit criterion. Run every step; any failure is a real bug: fix it (with a regression test in the owning layer — server pytest or core vitest) before proceeding. Use `superpowers:systematic-debugging` for anything non-obvious.

- [ ] **Step 1: Start a fresh server**

```bash
cd server && rm -rf /tmp/cc-e2e && CC_SECRET_KEY=e2e CC_DATA_DIR=/tmp/cc-e2e \
  uv run uvicorn --factory crossclipper.main:create_app --port 8080
```

Expected: startup complete; `curl -s http://localhost:8080/health` → `{"status":"ok"}`.

- [ ] **Step 2: Register + login two "devices"** (separate terminal)

```bash
cd /home/diego/projects/cross-clipper
export CC_CLI_DIR=/tmp/cc-cli-a
npm run cli --workspace @crossclipper/cli -- login http://localhost:8080 me@example.com hunter22! device-a
export CC_CLI_DIR=/tmp/cc-cli-b
npm run cli --workspace @crossclipper/cli -- login http://localhost:8080 me@example.com hunter22! device-b
```

Expected: first prints `registered new user (first run)` then `logged in`; second prints only `logged in` (registration locked, same credentials).

- [ ] **Step 3: Live delivery** — terminal B: `CC_CLI_DIR=/tmp/cc-cli-b npm run cli --workspace @crossclipper/cli -- listen`; terminal A: `CC_CLI_DIR=/tmp/cc-cli-a npm run cli --workspace @crossclipper/cli -- send hello from A`.
Expected: A prints `delivered <ULID>`; B prints `[<device-a-id>] hello from A` within a second.

- [ ] **Step 4: Reconnect + cursor gap** — Ctrl-C the server while B still listens (B shows `-- connecting`); from A, `send while you were away` (A's outbox retries — leave it running); restart the server (Step 1 command, keep `/tmp/cc-e2e`).
Expected: A's pending send delivers; B reconnects (`-- syncing` → `-- live`) and prints `[…] while you were away` exactly once. **This step proves the entire §4 reliability design.**

- [ ] **Step 5: Devices, revoke, tombstone**

```bash
CC_CLI_DIR=/tmp/cc-cli-a npm run cli --workspace @crossclipper/cli -- devices   # both devices listed
CC_CLI_DIR=/tmp/cc-cli-a npm run cli --workspace @crossclipper/cli -- feed      # both items listed
# delete an item via curl, watch B print "(deleted <id>)":
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/cc-cli-a/config.json'))['token'])")
ITEM=$(curl -s http://localhost:8080/api/v1/items -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys;print(json.load(sys.stdin)['items'][0]['id'])")
curl -s -X DELETE http://localhost:8080/api/v1/items/$ITEM -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}\n"   # 204
```

Expected: B (still listening) prints `(deleted <id>)`; a fresh `feed` no longer shows the item.

- [ ] **Step 6: Full-repo verification**

```bash
cd server && uv run pytest -v && cd .. && npm test && npm run typecheck
```

Expected: everything green (per superpowers:verification-before-completion — paste the actual output at the checkpoint, don't claim it).

- [ ] **Step 7: Commit any smoke-fix regression tests**, e.g. `fix(core): <what the smoke test caught>` — separate atomic commits per fix.

### PR 10 checkpoint

- [ ] **STOP — Diego review** (include the smoke-test transcript), then push + PR `feat(cli): throwaway CLI client for the end-to-end loop`.
- [ ] After merge: Phase 1 done. Next cycle: Phase 2 spec (browser extension) per §10.

---

## Self-review (performed while writing)

- **Spec coverage:** §3 data model → Task 2 (all five tables incl. Blob stub, ULIDs Task 6, tombstones Task 7); §4 REST → Tasks 3–7, WS → Tasks 8–9, pull-based sync → Task 15, version skew → Task 3; §5 auth flow → Tasks 3–4 (first-run lock, rate limit, hashed tokens, constant-time compare, size cap Task 6, CORS Task 2, http:// warning Task 17); §8 error spine → Tasks 12/15/16 (outbox+ULID idempotency, reconnect discipline, single 401 surface, structured errors Task 3); §9 testing → pytest throughout, OpenAPI snapshot Task 10, vitest scenarios Tasks 13–16; §10 phase 1 deliverables → all four (server, codegen, core, CLI). Excluded per scope: blobs endpoints, `/push/register`, Docker, GUI clients.
- **Type consistency check:** `AuthContext(user_id, device_id)` used in Tasks 4/5/6/8; `ItemOut`/`ItemsPage` field names identical across server schemas (Task 6), contract (Task 10), TS aliases (Task 11), FakeServer (Task 15); `WsLike`/`SocketFactory` shared by Tasks 14/15/17; `OutboxEntry`/`OutboxEvent` shared by Tasks 16/17; storage keys `cc.cursor`/`cc.outbox` consistent.
- **Known trade-offs (deliberate, not gaps):** rate limiter and hub are in-memory (single process per §2); `create_all` instead of migrations (decision 7); CLI has no unit tests (throwaway per §10; core carries the coverage).

---

# Amendment 2026-07-03: notification targeting (`target_device_id`)

Approved after plan writing (spec §3/§4 updated). Items carry an optional **notification target** — alerting only, never visibility. Binding on remaining tasks:

- **Task 6 (item creation):** `Item` model gains nullable `target_device_id` FK → `devices.id` (schema: add column to the Task-2 model; no migration tool — `create_all` on fresh DBs is fine). `POST /items` accepts optional `target_device_id`; validate it references a non-revoked device belonging to the user, else 422 `{code: "unknown_device"}`. Echo the field in the Item response schema.
- **Task 7 (feed):** `target_device_id` included in `GET /items` item payloads (and therefore in tombstone-scrubbed entries as-is).
- **Task 9 (WS broadcasts):** `item_new` events carry the full item incl. `target_device_id` (no server-side filtering — clients apply the notification policy locally in Phase 1).
- **Tasks 11–12 (codegen/ApiClient):** field flows through generated types; `createItem` accepts optional `targetDeviceId`.
- **Tasks 13–17 (core/CLI):** `Item` model includes the field; CLI prints a `→ <device>` marker on targeted items. No notification UI in Phase 1 — policy behavior (silent default, per-device toggle, target-always-notifies) is client-phase work.
