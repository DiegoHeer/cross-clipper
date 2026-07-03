from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class ItemKind(str, Enum):
    text = "text"
    link = "link"
    image = "image"  # defined day one (§3); rejected until the media phase
    file = "file"


class ItemIn(BaseModel):
    kind: ItemKind
    body: str
    id: str | None = None  # client-generated ULID; doubles as idempotency key
    target_device_id: str | None = None  # notification targeting only


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: ItemKind
    body: str
    origin_device_id: str
    target_device_id: str | None
    blob_id: str | None
    created_at: datetime
    deleted_at: datetime | None


class ItemsPage(BaseModel):
    items: list[ItemOut]
    next_cursor: str | None
