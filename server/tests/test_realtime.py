import pytest
from starlette.websockets import WebSocketDisconnect

from helpers import auth_headers, register_and_login


def test_ws_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws?token=bogus"):
            pass


def test_ws_ping_pong(client):
    token, _ = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
