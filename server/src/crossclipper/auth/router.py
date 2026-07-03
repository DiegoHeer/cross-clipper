from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from crossclipper.auth import service
from crossclipper.auth.deps import rate_limit, require_auth
from crossclipper.auth.repo import TokenRepo, UserRepo
from crossclipper.auth.schemas import LoginIn, LoginOut, RegisterIn, RegisterOut
from crossclipper.auth.service import AuthContext, new_token
from crossclipper.db.models import utcnow
from crossclipper.db.session import get_session
from crossclipper.devices.repo import DeviceRepo
from crossclipper.errors import AppError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=201, response_model=RegisterOut)
async def register(
    payload: RegisterIn, request: Request, session: Session = Depends(get_session)
) -> RegisterOut:
    rate_limit(request, "register")
    repo = UserRepo(session)
    if repo.count() > 0 and not request.app.state.settings.allow_registration:
        raise AppError(
            403, "registration_closed", "registration is closed on this server"
        )
    if repo.get_by_email(payload.email) is not None:
        raise AppError(409, "email_taken", "a user with this email already exists")
    try:
        user = repo.create(payload.email, service.hash_password(payload.password))
    except IntegrityError:
        raise AppError(409, "email_taken", "a user with this email already exists")
    return RegisterOut(user_id=user.id)


@router.post("/login", response_model=LoginOut)
async def login(
    payload: LoginIn, request: Request, session: Session = Depends(get_session)
) -> LoginOut:
    rate_limit(request, "login")
    user = UserRepo(session).get_by_email(payload.email)
    if user is None or not service.verify_password(
        payload.password, user.password_hash
    ):
        raise AppError(401, "invalid_credentials", "email or password is incorrect")
    device = DeviceRepo(session).create(
        user.id, payload.device_name, payload.platform.value
    )
    raw, token_hash = new_token()
    ttl = timedelta(days=request.app.state.settings.token_ttl_days)
    TokenRepo(session).create(user.id, device.id, token_hash, utcnow() + ttl)
    return LoginOut(token=raw, device_id=device.id)


@router.get("/whoami")
async def whoami(ctx: AuthContext = Depends(require_auth)) -> dict:
    return {"user_id": ctx.user_id, "device_id": ctx.device_id}
