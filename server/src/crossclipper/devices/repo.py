from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from crossclipper.db.models import Device, utcnow


class DeviceRepo:
    def __init__(self, session: Session):
        self.session = session

    def create(self, user_id: str, name: str, platform: str) -> Device:
        device = Device(id=uuid4().hex, user_id=user_id, name=name, platform=platform)
        self.session.add(device)
        self.session.flush()
        return device

    def get(self, user_id: str, device_id: str) -> Device | None:
        device = self.session.get(Device, device_id)
        if device is None or device.user_id != user_id:
            return None
        return device

    def list_active(self, user_id: str) -> list[Device]:
        stmt = (
            select(Device)
            .where(Device.user_id == user_id, Device.revoked_at.is_(None))
            .order_by(Device.created_at)
        )
        return list(self.session.scalars(stmt))

    def rename(self, device: Device, name: str) -> Device:
        device.name = name
        return device

    def revoke(self, device: Device) -> None:
        device.revoked_at = utcnow()
