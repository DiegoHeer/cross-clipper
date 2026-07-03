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
        return JSONResponse(
            status_code=503, content={"code": "unhealthy", "message": str(exc)}
        )
    return {"status": "ok"}
