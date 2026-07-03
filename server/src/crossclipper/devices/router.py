from fastapi import APIRouter, Depends, Response
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
async def list_devices(ctx: AuthContext = Depends(require_auth),
                       session: Session = Depends(get_session)) -> DevicesOut:
    devices = DeviceRepo(session).list_active(ctx.user_id)
    return DevicesOut(devices=[DeviceOut.model_validate(d) for d in devices])


@router.patch("/{device_id}", response_model=DeviceOut)
async def rename_device(device_id: str, payload: DeviceRenameIn,
                        ctx: AuthContext = Depends(require_auth),
                        session: Session = Depends(get_session)) -> DeviceOut:
    repo = DeviceRepo(session)
    device = repo.get(ctx.user_id, device_id)
    if device is None or device.revoked_at is not None:
        raise AppError(404, "not_found", "device not found")
    return DeviceOut.model_validate(repo.rename(device, payload.name))


@router.delete("/{device_id}", status_code=204)
async def revoke_device(device_id: str,
                        ctx: AuthContext = Depends(require_auth),
                        session: Session = Depends(get_session)) -> Response:
    repo = DeviceRepo(session)
    device = repo.get(ctx.user_id, device_id)
    if device is None:
        raise AppError(404, "not_found", "device not found")
    repo.revoke(device)
    TokenRepo(session).delete_for_device(device.id)
    return Response(status_code=204)
