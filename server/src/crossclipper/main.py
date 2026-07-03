import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from crossclipper import health
from crossclipper.auth import router as auth_router
from crossclipper.auth.ratelimit import RateLimiter
from crossclipper.config import Settings
from crossclipper.db.models import utcnow
from crossclipper.db.session import init_db, make_engine
from crossclipper.devices import router as devices_router
from crossclipper.errors import register_error_handlers
from crossclipper.items import router as items_router
from crossclipper.items.repo import ItemRepo
from crossclipper.protocol import version_ok
from crossclipper.realtime import router as realtime_router
from crossclipper.realtime.hub import Hub

logger = logging.getLogger(__name__)


def _prune(engine, settings) -> None:
    cutoff = utcnow() - timedelta(days=settings.tombstone_retention_days)
    with Session(engine) as session:
        ItemRepo(session).prune_tombstones(cutoff)
        session.commit()


def _safe_prune(prune_fn: Callable[[], None]) -> None:
    """Call prune_fn, swallowing and logging any exception so the loop survives."""
    try:
        prune_fn()
    except Exception:
        logger.exception("daily prune failed; will retry next cycle")


@asynccontextmanager
async def _lifespan(app):
    _prune(app.state.engine, app.state.settings)

    async def daily():
        while True:
            await asyncio.sleep(24 * 3600)
            _safe_prune(lambda: _prune(app.state.engine, app.state.settings))

    task = asyncio.create_task(daily())
    yield
    task.cancel()


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


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    ensure_writable_data_dir(settings)

    engine = make_engine(settings.database_url)
    init_db(engine)

    app = FastAPI(title="CrossClipper", version="0.1.0", lifespan=_lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.limiter = RateLimiter(max_events=10, window_seconds=60)
    app.state.hub = Hub()

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    register_error_handlers(app)

    @app.middleware("http")
    async def client_version_gate(request: Request, call_next):
        version = request.headers.get("x-client-version")
        minimum = request.app.state.settings.min_client_version
        if version and not version_ok(version, minimum):
            return JSONResponse(
                status_code=426,
                content={
                    "code": "client_too_old",
                    "message": f"minimum supported client version is {minimum}",
                },
            )
        return await call_next(request)

    app.include_router(health.router)
    app.include_router(auth_router.router, prefix="/api/v1")
    app.include_router(devices_router.router, prefix="/api/v1")
    app.include_router(items_router.router, prefix="/api/v1")
    app.include_router(realtime_router.router, prefix="/api/v1")
    return app
