import pytest
from starlette.websockets import WebSocketDisconnect

from helpers import register_and_login


def test_ws_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/ws?token=bogus"):
            pass
    assert exc_info.value.code == 4401


def test_ws_ping_pong(client):
    token, _ = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_ws_malformed_json_closes_4400(client):
    """Non-JSON text frame must close with code 4400 (bad request)."""
    token, _ = register_and_login(client)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
            ws.send_text("this is not json{{")
            # Trigger the server to process the bad frame and close.
            ws.receive_json()
    assert exc_info.value.code == 4400


def test_ws_hub_not_corrupted_after_malformed_json(client):
    """Hub must be clean after a bad-frame disconnect; second valid connection works."""
    token, _ = register_and_login(client)
    # First connection — send bad frame, gets closed.
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
            ws.send_text("bad json")
            ws.receive_json()
    # Second connection — hub must not be corrupted.
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
