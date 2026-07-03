import pytest
from starlette.websockets import WebSocketDisconnect

from helpers import auth_headers, register_and_login


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


def test_item_post_broadcasts_item_new(client):
    token, device_id = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        r = client.post("/api/v1/items", json={"kind": "text", "body": "hi"},
                        headers=auth_headers(token))
        assert r.status_code == 201
        event = ws.receive_json()
    assert event["type"] == "item_new"
    assert event["item"]["body"] == "hi"
    assert event["item"]["origin_device_id"] == device_id


def test_item_post_idempotent_replay_no_broadcast(client):
    """Idempotent replay (same id, 200) must NOT broadcast item_new again."""
    token, _ = register_and_login(client)
    # Create the item once to get its id.
    r = client.post("/api/v1/items", json={"kind": "text", "body": "once"},
                    headers=auth_headers(token))
    assert r.status_code == 201
    item_id = r.json()["id"]
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        # Replay with the same id — should return 200, no broadcast.
        r2 = client.post("/api/v1/items", json={"kind": "text", "body": "once", "id": item_id},
                         headers=auth_headers(token))
        assert r2.status_code == 200
        # Confirm still alive via ping — if item_new had fired we'd receive it before pong.
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_item_delete_broadcasts_item_deleted(client):
    token, _ = register_and_login(client)
    item = client.post("/api/v1/items", json={"kind": "text", "body": "x"},
                       headers=auth_headers(token)).json()
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        client.delete(f"/api/v1/items/{item['id']}", headers=auth_headers(token))
        assert ws.receive_json() == {"type": "item_deleted", "item_id": item["id"]}


def test_device_mutations_broadcast_device_changed(client):
    token, device_id = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        client.patch(f"/api/v1/devices/{device_id}", json={"name": "n"},
                     headers=auth_headers(token))
        assert ws.receive_json() == {"type": "device_changed"}
        register_and_login(client, device_name="second")  # login → new device
        assert ws.receive_json() == {"type": "device_changed"}
