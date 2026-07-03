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
