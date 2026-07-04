from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from crossclipper.auth.deps import require_auth
from crossclipper.auth.repo import TokenRepo
from crossclipper.auth.service import AuthContext
from crossclipper.db.session import get_session
from crossclipper.devices.repo import DeviceRepo
from crossclipper.devices.schemas import DeviceOut, DeviceRenameIn, DevicesOut
from crossclipper.errors import AppError

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=DevicesOut)
async def list_devices(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> DevicesOut:
    hub = request.app.state.hub
    devices = DeviceRepo(session).list_active(ctx.user_id)
    return DevicesOut(
        devices=[
            DeviceOut(
                id=d.id,
                name=d.name,
                platform=d.platform,
                last_seen_at=d.last_seen_at,
                created_at=d.created_at,
                online=hub.is_online(ctx.user_id, d.id),
            )
            for d in devices
        ]
    )


@router.patch("/{device_id}", response_model=DeviceOut)
async def rename_device(
    device_id: str,
    payload: DeviceRenameIn,
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> DeviceOut:
    hub = request.app.state.hub
    repo = DeviceRepo(session)
    device = repo.get(ctx.user_id, device_id)
    if device is None or device.revoked_at is not None:
        raise AppError(404, "not_found", "device not found")
    renamed = repo.rename(device, payload.name)
    session.commit()
    await hub.broadcast(ctx.user_id, {"type": "device_changed"})
    return DeviceOut(
        id=renamed.id,
        name=renamed.name,
        platform=renamed.platform,
        last_seen_at=renamed.last_seen_at,
        created_at=renamed.created_at,
        online=hub.is_online(ctx.user_id, renamed.id),
    )


@router.delete("/{device_id}", status_code=204)
async def revoke_device(
    device_id: str,
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    repo = DeviceRepo(session)
    device = repo.get(ctx.user_id, device_id)
    if device is None or device.revoked_at is not None:
        raise AppError(404, "not_found", "device not found")
    repo.revoke(device)
    TokenRepo(session).delete_for_device(device.id)
    session.commit()
    # Order: commit → close revoked socket → broadcast device_changed to the rest.
    await request.app.state.hub.close_device(ctx.user_id, device_id)
    await request.app.state.hub.broadcast(ctx.user_id, {"type": "device_changed"})
    return Response(status_code=204)
