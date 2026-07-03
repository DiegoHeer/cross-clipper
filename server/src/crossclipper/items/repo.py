from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from crossclipper.db.models import Item, utcnow


class ItemRepo:
    def __init__(self, session: Session):
        self.session = session

    # ------------------------------------------------------------------
    # Monotonic sequence helpers
    # ------------------------------------------------------------------

    def _next_seq(self, user_id: str) -> int:
        """Return max(sync_seq)+1 for this user's items within the current
        transaction.

        Monotonicity approach: we compute max(sync_seq)+1 inside the same
        SQLAlchemy transaction that will write the row.  SQLite's default
        serialised-write model (one writer at a time) means no two
        concurrent writes can observe the same max, so there are no gaps or
        duplicates.  If the table is empty (first item) the aggregate returns
        NULL; coalesce to 0 so the first value is 1.

        Note: relies on SQLAlchemy autoflush — the select() flushes pending
        rows before executing. If autoflush is ever disabled, same-session
        creates could read a stale max(sync_seq).
        """
        result = self.session.execute(
            select(func.coalesce(func.max(Item.sync_seq), 0)).where(
                Item.user_id == user_id
            )
        )
        return result.scalar_one() + 1

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def get(self, user_id: str, item_id: str) -> Item | None:
        item = self.session.get(Item, item_id)
        if item is None or item.user_id != user_id:
            return None
        return item

    def create(
        self,
        *,
        id: str,
        user_id: str,
        origin_device_id: str,
        kind: str,
        body: str,
        target_device_id: str | None = None,
    ) -> Item:
        item = Item(
            id=id,
            user_id=user_id,
            origin_device_id=origin_device_id,
            target_device_id=target_device_id,
            kind=kind,
            body=body,
            sync_seq=self._next_seq(user_id),
        )
        self.session.add(item)
        self.session.flush()
        return item

    def list_page(
        self,
        user_id: str,
        *,
        cursor: str | None,
        origin: str | None,
        limit: int,
        include_deleted: bool,
    ) -> tuple[list[Item], str | None]:
        """Return a page of items ordered by sync_seq.

        cursor is an opaque string containing the integer sync_seq value
        returned as next_cursor from a prior call.  Invalid / non-numeric
        cursors are treated as 0 (deliver everything) rather than crashing —
        this preserves the "malformed cursor must not 500" contract.
        """
        seq_cursor: int
        if cursor is not None:
            try:
                seq_cursor = int(cursor)
            except (ValueError, TypeError):
                # Non-integer cursor: treat as floor (deliver all items).
                seq_cursor = 0
        else:
            seq_cursor = 0  # no cursor supplied — initial cold pull

        stmt = (
            select(Item)
            .where(Item.user_id == user_id)
            .where(Item.sync_seq > seq_cursor)
            .order_by(Item.sync_seq)
            .limit(limit + 1)
        )
        if origin:
            stmt = stmt.where(Item.origin_device_id == origin)
        if not include_deleted:
            stmt = stmt.where(Item.deleted_at.is_(None))
        rows = list(self.session.scalars(stmt))
        page = rows[:limit]
        if not page:
            return [], None
        next_cursor = str(page[-1].sync_seq)
        # Always return next_cursor so clients can use it for incremental pulls.
        # Even when there is no "next page", the cursor marks where the client
        # is so future deletes (sync_seq re-assigned beyond this point) surface.
        return page, next_cursor

    def soft_delete(self, item: Item) -> None:
        if item.deleted_at is None:
            item.deleted_at = utcnow()
            item.body = ""  # tombstones carry no content
            # Re-assign sync_seq so the tombstone moves ahead of any client
            # cursor that had already consumed this item when it was live.
            item.sync_seq = self._next_seq(item.user_id)

    def prune_tombstones(self, cutoff: datetime) -> int:
        result = self.session.execute(
            delete(Item).where(Item.deleted_at.is_not(None), Item.deleted_at < cutoff)
        )
        return result.rowcount
