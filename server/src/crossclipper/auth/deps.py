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
