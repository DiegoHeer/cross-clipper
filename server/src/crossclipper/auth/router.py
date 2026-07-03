from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import IntegrityError
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
    try:
        user = repo.create(payload.email, service.hash_password(payload.password))
    except IntegrityError:
        raise AppError(409, "email_taken", "a user with this email already exists")
    return RegisterOut(user_id=user.id)
