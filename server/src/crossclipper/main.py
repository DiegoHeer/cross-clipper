from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from crossclipper import health
from crossclipper.auth import router as auth_router
from crossclipper.config import Settings
from crossclipper.db.session import init_db, make_engine
from crossclipper.errors import register_error_handlers
from crossclipper.protocol import version_ok


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

    register_error_handlers(app)

    @app.middleware("http")
    async def client_version_gate(request: Request, call_next):
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
