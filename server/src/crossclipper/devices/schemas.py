from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    platform: str
    last_seen_at: datetime
    created_at: datetime


class DevicesOut(BaseModel):
    devices: list[DeviceOut]


class DeviceRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
