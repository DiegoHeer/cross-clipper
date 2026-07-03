from collections import defaultdict

from fastapi import WebSocket


class Hub:
    """In-memory per-user socket registry. One process, one hub (§2)."""

    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)

    def add(self, user_id: str, ws: WebSocket) -> None:
        self._sockets[user_id].add(ws)

    def remove(self, user_id: str, ws: WebSocket) -> None:
        self._sockets[user_id].discard(ws)

    async def broadcast(self, user_id: str, event: dict) -> None:
        for ws in list(self._sockets.get(user_id, ())):
            try:
                await ws.send_json(event)
            except Exception:  # noqa: BLE001 — a dead socket must not break the send
                self.remove(user_id, ws)
