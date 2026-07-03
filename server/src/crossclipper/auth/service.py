import hashlib
import hmac
import secrets
from dataclasses import dataclass

import bcrypt
from sqlalchemy.orm import Session

from crossclipper.db.models import Device, utcnow


def hash_password(password: str) -> str:
    """Hash *password* with bcrypt.

    Belt-and-braces: raises ``AppError(422)`` if bcrypt rejects the password
    (e.g. > 72 UTF-8 bytes).  In normal operation the schema validator catches
    this first; this guard protects future call sites that bypass the schema.
    """
    try:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    except ValueError as exc:
        from crossclipper.errors import AppError  # local import avoids cycle

        raise AppError(422, "validation_error", str(exc)) from exc


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


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
    """Validate a raw bearer token and return its AuthContext, or None if invalid.

    Side-effect: updates ``device.last_seen_at`` on success.  This write is
    committed by the ``get_session`` dependency that the HTTP layer wraps around
    each request (commit-on-success / rollback-on-error).  Any future non-HTTP
    caller (e.g. the WebSocket handler in Task 8) MUST commit the session
    explicitly after this function returns, or the touch will be silently dropped.
    Do NOT refactor into a separate ``touch_device()`` call — Task 8 will revisit.
    """
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
