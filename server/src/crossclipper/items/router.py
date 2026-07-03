from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ulid import ULID

from crossclipper.auth.deps import require_auth
from crossclipper.auth.service import AuthContext
from crossclipper.db.models import Device
from crossclipper.db.session import get_session
from crossclipper.errors import AppError
from crossclipper.items.repo import ItemRepo
from crossclipper.items.schemas import ItemIn, ItemKind, ItemOut, ItemsPage

router = APIRouter(prefix="/items", tags=["items"])

_SUPPORTED_KINDS = {ItemKind.text, ItemKind.link}


@router.post("", status_code=201, response_model=ItemOut)
async def create_item(
    payload: ItemIn,
    request: Request,
    response: Response,
    ctx: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ItemOut:
    if payload.kind not in _SUPPORTED_KINDS:
        raise AppError(
            422, "unsupported_kind", f"kind '{payload.kind.value}' is not supported yet"
        )

    max_bytes = request.app.state.settings.item_max_bytes
    if len(payload.body.encode("utf-8")) > max_bytes:
        raise AppError(413, "item_too_large", f"item body exceeds {max_bytes} bytes")

    # Validate target_device_id if supplied: must be a non-revoked device of this user
    if payload.target_device_id is not None:
        device = session.get(Device, payload.target_device_id)
        if (
            device is None
            or device.user_id != ctx.user_id
            or device.revoked_at is not None
        ):
            raise AppError(
                422,
                "unknown_device",
                "target_device_id does not reference a valid device",
            )

    repo = ItemRepo(session)
    if payload.id is not None:
        try:
            ULID.from_str(payload.id)
        except ValueError:
            raise AppError(422, "invalid_id", "item id must be a valid ULID")
        existing = repo.get(ctx.user_id, payload.id)
        if existing is not None:
            response.status_code = 200  # idempotent replay
            return ItemOut.model_validate(existing)

    try:
        item = repo.create(
            id=payload.id or str(ULID()),
            user_id=ctx.user_id,
            origin_device_id=ctx.device_id,
            kind=payload.kind.value,
            body=payload.body,
            target_device_id=payload.target_device_id,
        )
    except IntegrityError:
        # The id is already held by another user — never leak that item's existence.
        raise AppError(
            422,
            "id_conflict",
            "the supplied id is already in use; omit id to let the server mint one",
        )
    return ItemOut.model_validate(item)


@router.get("", response_model=ItemsPage)
async def list_items(
    cursor: str | None = None,
    origin: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    ctx: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ItemsPage:
    items, next_cursor = ItemRepo(session).list_page(
        ctx.user_id,
        cursor=cursor,
        origin=origin,
        limit=limit,
        include_deleted=cursor is not None,
    )
    return ItemsPage(
        items=[ItemOut.model_validate(i) for i in items], next_cursor=next_cursor
    )


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    ctx: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    repo = ItemRepo(session)
    item = repo.get(ctx.user_id, item_id)
    if item is None:
        raise AppError(404, "not_found", "item not found")
    repo.soft_delete(item)
    return Response(status_code=204)
