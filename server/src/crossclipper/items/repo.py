from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from crossclipper.db.models import Item, utcnow


class ItemRepo:
    def __init__(self, session: Session):
        self.session = session

    def get(self, user_id: str, item_id: str) -> Item | None:
        item = self.session.get(Item, item_id)
        if item is None or item.user_id != user_id:
            return None
        return item

    def create(self, *, id: str, user_id: str, origin_device_id: str,
               kind: str, body: str, target_device_id: str | None = None) -> Item:
        item = Item(
            id=id,
            user_id=user_id,
            origin_device_id=origin_device_id,
            target_device_id=target_device_id,
            kind=kind,
            body=body,
        )
        self.session.add(item)
        self.session.flush()
        return item

    def list_page(self, user_id: str, *, cursor: str | None, origin: str | None,
                  limit: int, include_deleted: bool) -> tuple[list[Item], str | None]:
        stmt = (select(Item).where(Item.user_id == user_id)
                .order_by(Item.id).limit(limit + 1))
        if cursor:
            stmt = stmt.where(Item.id > cursor)
        if origin:
            stmt = stmt.where(Item.origin_device_id == origin)
        if not include_deleted:
            stmt = stmt.where(Item.deleted_at.is_(None))
        rows = list(self.session.scalars(stmt))
        if len(rows) > limit:
            return rows[:limit], rows[limit - 1].id
        return rows, None

    def soft_delete(self, item: Item) -> None:
        if item.deleted_at is None:
            item.deleted_at = utcnow()
            item.body = ""  # tombstones carry no content

    def prune_tombstones(self, cutoff: datetime) -> int:
        result = self.session.execute(
            delete(Item).where(Item.deleted_at.is_not(None), Item.deleted_at < cutoff))
        return result.rowcount
