from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from crossclipper.db.models import AuthToken, User


class UserRepo:
    def __init__(self, session: Session):
        self.session = session

    def count(self) -> int:
        return self.session.scalar(select(func.count()).select_from(User)) or 0

    def get_by_email(self, email: str) -> User | None:
        return self.session.scalar(select(User).where(User.email == email))

    def create(self, email: str, password_hash: str) -> User:
        user = User(id=uuid4().hex, email=email, password_hash=password_hash)
        self.session.add(user)
        self.session.flush()
        return user


class TokenRepo:
    def __init__(self, session: Session):
        self.session = session

    def create(self, user_id: str, device_id: str, token_hash: str, expires_at) -> AuthToken:
        token = AuthToken(id=uuid4().hex, user_id=user_id, device_id=device_id,
                          token_hash=token_hash, expires_at=expires_at)
        self.session.add(token)
        self.session.flush()
        return token

    def get_by_hash(self, token_hash: str) -> AuthToken | None:
        return self.session.scalar(select(AuthToken).where(AuthToken.token_hash == token_hash))

    def delete_for_device(self, device_id: str) -> None:
        for row in self.session.scalars(select(AuthToken).where(AuthToken.device_id == device_id)):
            self.session.delete(row)
