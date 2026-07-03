from enum import Enum

from pydantic import BaseModel, Field


class Platform(str, Enum):
    ios = "ios"
    android = "android"
    windows = "windows"
    extension = "extension"
    other = "other"


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class RegisterOut(BaseModel):
    user_id: str


class LoginIn(BaseModel):
    email: str
    password: str
    device_name: str = Field(min_length=1, max_length=120)
    platform: Platform


class LoginOut(BaseModel):
    token: str
    device_id: str
