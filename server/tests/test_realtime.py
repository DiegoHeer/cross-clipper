import pytest
from helpers import auth_headers, register_and_login
from starlette.websockets import WebSocketDisconnect


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
        r = client.post(
            "/api/v1/items",
            json={"kind": "text", "body": "hi"},
            headers=auth_headers(token),
        )
        assert r.status_code == 201
        event = ws.receive_json()
    assert event["type"] == "item_new"
    assert event["item"]["body"] == "hi"
    assert event["item"]["origin_device_id"] == device_id


def test_item_post_idempotent_replay_no_broadcast(client):
    """Idempotent replay (same id, 200) must NOT broadcast item_new again."""
    token, _ = register_and_login(client)
    # Create the item once to get its id.
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "once"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    item_id = r.json()["id"]
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        # Replay with the same id — should return 200, no broadcast.
        r2 = client.post(
            "/api/v1/items",
            json={"kind": "text", "body": "once", "id": item_id},
            headers=auth_headers(token),
        )
        assert r2.status_code == 200
        # Confirm still alive via ping — if item_new had fired we'd receive it before pong.
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_item_delete_broadcasts_item_deleted(client):
    token, _ = register_and_login(client)
    item = client.post(
        "/api/v1/items", json={"kind": "text", "body": "x"}, headers=auth_headers(token)
    ).json()
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        client.delete(f"/api/v1/items/{item['id']}", headers=auth_headers(token))
        assert ws.receive_json() == {"type": "item_deleted", "item_id": item["id"]}


def test_device_mutations_broadcast_device_changed(client):
    # register_and_login called twice with the same default email/password:
    # first call registers + logs in (device A); second call hits 409 on register
    # (user already exists) then logs into the SAME user, creating a second device.
    # Both devices share the same user_id, so device_changed broadcasts reach A's socket.
    token, device_id = register_and_login(client)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        client.patch(
            f"/api/v1/devices/{device_id}",
            json={"name": "n"},
            headers=auth_headers(token),
        )
        assert ws.receive_json() == {"type": "device_changed"}
        register_and_login(
            client, device_name="second"
        )  # login → new device, same user
        assert ws.receive_json() == {"type": "device_changed"}


# ---------------------------------------------------------------------------
# Finding 1: cross-user broadcast isolation
# ---------------------------------------------------------------------------


@pytest.fixture
def multi_user_client(tmp_path):
    """App with allow_registration=True so two real users can register."""
    from fastapi.testclient import TestClient

    from crossclipper.config import Settings
    from crossclipper.main import create_app

    settings = Settings(
        secret_key="test-secret", data_dir=tmp_path, allow_registration=True
    )
    with TestClient(create_app(settings)) as c:
        yield c


def test_cross_user_broadcast_isolation(multi_user_client):
    """User A posts an item; A's socket receives item_new; B's socket receives nothing.

    Probe ordering: after the REST call completes, send ping on B's socket and
    assert the next frame is pong (not item_new).  Because TestClient drives the
    event loop synchronously, the broadcast for A's POST is fully processed before
    we even send B's ping — so if item_new had been delivered to B, it would
    arrive before the pong.  No sleeps needed.
    """
    c = multi_user_client
    token_a, _ = register_and_login(
        c, email="alice@example.com", password="alice-pw1!", device_name="alice-device"
    )
    token_b, _ = register_and_login(
        c, email="bob@example.com", password="bob-pw1!", device_name="bob-device"
    )

    with (
        c.websocket_connect(f"/api/v1/ws?token={token_a}") as ws_a,
        c.websocket_connect(f"/api/v1/ws?token={token_b}") as ws_b,
    ):
        # A posts an item — should broadcast only to A.
        r = c.post(
            "/api/v1/items",
            json={"kind": "text", "body": "secret"},
            headers=auth_headers(token_a),
        )
        assert r.status_code == 201

        # A's socket receives the item_new event.
        event_a = ws_a.receive_json()
        assert event_a["type"] == "item_new"
        assert event_a["item"]["body"] == "secret"

        # B's socket must NOT have received item_new.
        # Probe: send ping, assert the very next frame is pong — not item_new.
        ws_b.send_json({"type": "ping"})
        assert ws_b.receive_json() == {"type": "pong"}


# ---------------------------------------------------------------------------
# Finding 3: revoke closes revoked device's WS; survivor gets device_changed
# ---------------------------------------------------------------------------


def test_revoke_closes_revoked_ws_survivor_gets_device_changed(client):
    """Revoking device B closes B's live WS (code 4401).

    Device A's socket stays functional and receives device_changed.
    """
    # Two devices for the same user (register_and_login reuses the same account
    # after the first registration — see helpers.py: 409 on re-register is ok).
    token_a, device_a = register_and_login(client, device_name="device-a")
    token_b, device_b = register_and_login(client, device_name="device-b")

    with client.websocket_connect(f"/api/v1/ws?token={token_a}") as ws_a:
        # Open B's socket and immediately check it's alive.
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/api/v1/ws?token={token_b}") as ws_b:
                # B's connect is a presence transition → A receives device_changed.
                # Drain it now so the queue is clean for the revocation event.
                assert ws_a.receive_json() == {"type": "device_changed"}

                # Confirm B's socket is live before revocation.
                ws_b.send_json({"type": "ping"})
                assert ws_b.receive_json() == {"type": "pong"}

                # A revokes B — server must close B's socket with code 4401.
                r = client.delete(
                    f"/api/v1/devices/{device_b}", headers=auth_headers(token_a)
                )
                assert r.status_code == 204

                # B's next receive must raise WebSocketDisconnect(code=4401).
                ws_b.receive_json()  # raises

        assert exc_info.value.code == 4401

        # A received device_changed after the revocation
        # (broadcast fires after close_device — receive it first).
        event = ws_a.receive_json()
        assert event == {"type": "device_changed"}

        # A's socket is unaffected — ping/pong still works after the event.
        ws_a.send_json({"type": "ping"})
        assert ws_a.receive_json() == {"type": "pong"}
