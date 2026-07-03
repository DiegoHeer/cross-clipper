from enum import Enum

from pydantic import BaseModel, Field, field_validator

_BCRYPT_MAX_BYTES = 72


def _check_password_byte_length(v: str) -> str:
    """Reject passwords whose UTF-8 encoding exceeds 72 bytes (bcrypt hard limit).

    Pydantic's ``max_length`` counts characters, not bytes.  A 40-character
    multibyte password (e.g. ``'é' * 40``) passes ``max_length=72`` but
    encodes to 80 bytes and would raise ``ValueError`` inside bcrypt.
    """
    if len(v.encode()) > _BCRYPT_MAX_BYTES:
        raise ValueError(f"password must not exceed {_BCRYPT_MAX_BYTES} UTF-8 bytes")
    return v


class Platform(str, Enum):
    ios = "ios"
    android = "android"
    windows = "windows"
    extension = "extension"
    other = "other"


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    # max_length=72 matches the bcrypt byte limit for ASCII passwords; the byte
    # validator below additionally rejects multibyte passwords that exceed 72 bytes.
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def password_within_bcrypt_limit(cls, v: str) -> str:
        return _check_password_byte_length(v)


class RegisterOut(BaseModel):
    user_id: str


class LoginIn(BaseModel):
    email: str
    # No max_length on login password to avoid leaking schema info, but the byte
    # validator still rejects over-long passwords before they reach bcrypt.
    password: str
    device_name: str = Field(min_length=1, max_length=120)
    platform: Platform

    @field_validator("password")
    @classmethod
    def password_within_bcrypt_limit(cls, v: str) -> str:
        return _check_password_byte_length(v)


class LoginOut(BaseModel):
    token: str
    device_id: str
