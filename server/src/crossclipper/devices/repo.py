from uuid import uuid4

from sqlalchemy.orm import Session

from crossclipper.db.models import Device


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
