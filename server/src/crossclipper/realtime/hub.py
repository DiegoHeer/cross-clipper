from collections import defaultdict

from fastapi import WebSocket


class Hub:
    """In-memory per-user socket registry. One process, one hub (§2).

    Sockets are keyed by (user_id, device_id) to support per-device operations
    such as closing a revoked device's live connection.
    """

    def __init__(self) -> None:
        # user_id → device_id → set[WebSocket]
        self._sockets: dict[str, dict[str, set[WebSocket]]] = defaultdict(
            lambda: defaultdict(set)
        )

    def add(self, user_id: str, device_id: str, ws: WebSocket) -> None:
        self._sockets[user_id][device_id].add(ws)

    def remove(self, user_id: str, device_id: str, ws: WebSocket) -> None:
        device_map = self._sockets.get(user_id)
        if device_map is None:
            return
        sockets = device_map.get(device_id)
        if sockets is None:
            return
        sockets.discard(ws)
        if not sockets:
            del device_map[device_id]
        if not device_map:
            del self._sockets[user_id]

    async def close_device(self, user_id: str, device_id: str) -> None:
        """Close all sockets for the given device with code 4401 (revoked).

        Swallows per-socket errors so a partially-closed socket never aborts
        the rest.  Cleans up hub state regardless of close outcome.
        """
        device_map = self._sockets.get(user_id, {})
        sockets = list(device_map.get(device_id, ()))
        for ws in sockets:
            try:
                await ws.close(code=4401)
            except Exception:  # noqa: BLE001
                pass
        # Remove all device sockets from registry unconditionally.
        if user_id in self._sockets:
            self._sockets[user_id].pop(device_id, None)
            if not self._sockets[user_id]:
                del self._sockets[user_id]

    async def broadcast(self, user_id: str, event: dict) -> None:
        for device_sockets in list(self._sockets.get(user_id, {}).values()):
            for ws in list(device_sockets):
                try:
                    await ws.send_json(event)
                except Exception:  # noqa: BLE001 — a dead socket must not break the send
                    pass
