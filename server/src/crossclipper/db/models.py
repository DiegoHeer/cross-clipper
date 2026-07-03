from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    """Naive UTC timestamp — the one time format used everywhere."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    platform: Mapped[str] = mapped_column(
        String(16)
    )  # ios|android|windows|extension|other
    push_token: Mapped[str | None] = mapped_column(String(512), default=None)
    push_transport: Mapped[str | None] = mapped_column(String(16), default=None)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (Index("ix_items_user_sync_seq", "user_id", "sync_seq"),)

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    origin_device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"))
    target_device_id: Mapped[str | None] = mapped_column(
        ForeignKey("devices.id"), default=None
    )
    kind: Mapped[str] = mapped_column(String(8))  # text|link|image|file
    body: Mapped[str] = mapped_column(Text)
    blob_id: Mapped[str | None] = mapped_column(ForeignKey("blobs.id"), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(default=None, index=True)
    # Monotonic modification sequence — assigned on create and RE-ASSIGNED on
    # soft-delete so tombstones always move ahead of any existing client cursor.
    # max(sync_seq)+1 within the write transaction is safe for SQLite's
    # single-writer model (WAL mode or serialized writes via the same connection
    # pool ensure no two concurrent transactions can race on the same user's rows).
    sync_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Blob(Base):
    """Schema stub — no endpoints until the media phase."""

    __tablename__ = "blobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int]
    mime: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(512))
    thumb_key: Mapped[str | None] = mapped_column(String(512), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
