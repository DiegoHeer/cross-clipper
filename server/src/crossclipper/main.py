import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

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


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.blobs_dir.mkdir(parents=True, exist_ok=True)

    engine = make_engine(settings.database_url)
    init_db(engine)

    app = FastAPI(title="CrossClipper", version="0.1.0", lifespan=_lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.limiter = RateLimiter(max_events=10, window_seconds=60)

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
    return app
