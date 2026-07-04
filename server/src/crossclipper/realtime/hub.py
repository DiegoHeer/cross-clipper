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

    def add(self, user_id: str, device_id: str, ws: WebSocket) -> bool:
        """Register a socket and return True iff this is the device's first socket (offline→online)."""
        self._sockets[user_id][device_id].add(ws)
        return len(self._sockets[user_id][device_id]) == 1

    def remove(self, user_id: str, device_id: str, ws: WebSocket) -> bool:
        """Unregister a socket and return True iff this was the device's last socket (online→offline)."""
        device_map = self._sockets.get(user_id)
        if device_map is None:
            return False
        sockets = device_map.get(device_id)
        if sockets is None:
            return False
        sockets.discard(ws)
        if not sockets:
            del device_map[device_id]
            if not device_map:
                del self._sockets[user_id]
            return True
        return False

    def is_online(self, user_id: str, device_id: str) -> bool:
        """Return True iff the device currently holds at least one open socket."""
        device_map = self._sockets.get(user_id)
        if device_map is None:
            return False
        return device_id in device_map

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

    async def broadcast(
        self, user_id: str, event: dict, exclude: "WebSocket | None" = None
    ) -> None:
        """Send *event* to every socket for *user_id*, optionally skipping one socket.

        Sockets that raise on send are presumed dead (client vanished without a
        close handshake).  They are pruned from the registry after the send loop
        completes — safe against mutation-during-iteration because the loop
        snapshots each device's socket set with ``list()``.  If pruning takes a
        device's socket count to zero, the same offline transition is produced as
        a normal disconnect: a ``device_changed`` broadcast fires for the user.
        """
        dead: list[tuple[str, WebSocket]] = []  # (device_id, ws) pairs that failed

        for device_id, device_sockets in list(self._sockets.get(user_id, {}).items()):
            for ws in list(device_sockets):
                if ws is exclude:
                    continue
                try:
                    await ws.send_json(event)
                except Exception:  # noqa: BLE001 — dead socket must not abort delivery
                    dead.append((device_id, ws))

        # Prune dead sockets outside the iteration loop — safe, no concurrent mutation.
        offline_transitions: list[str] = []
        for device_id, ws in dead:
            went_offline = self.remove(user_id, device_id, ws)
            if went_offline:
                offline_transitions.append(device_id)

        # Fire device_changed for each device that went offline due to pruning.
        # The event carries no device id — same shape as the router's disconnect path.
        for _device_id in offline_transitions:
            try:
                await self.broadcast(user_id, {"type": "device_changed"})
            except Exception:  # noqa: BLE001
                pass
