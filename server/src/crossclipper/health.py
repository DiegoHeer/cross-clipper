from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as pkg_version

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
