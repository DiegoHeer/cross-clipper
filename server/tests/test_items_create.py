"""Tests for POST /api/v1/items — kinds, size cap, ULID idempotency, target_device_id."""

import pytest
from helpers import auth_headers, register_and_login
from ulid import ULID


def test_create_text_item(client):
    token, device_id = register_and_login(client)
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "hello"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    item = r.json()
    assert item["kind"] == "text" and item["body"] == "hello"
    assert item["origin_device_id"] == device_id
    assert item["deleted_at"] is None and item["blob_id"] is None
    assert item["target_device_id"] is None
    ULID.from_str(item["id"])  # server-minted id is a valid ULID


def test_create_link_item(client):
    token, _ = register_and_login(client)
    r = client.post(
        "/api/v1/items",
        json={"kind": "link", "body": "https://example.com"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    assert r.json()["kind"] == "link"


def test_client_supplied_ulid_is_idempotency_key(client):
    token, _ = register_and_login(client)
    item_id = str(ULID())
    payload = {"kind": "text", "body": "once", "id": item_id}
    r1 = client.post("/api/v1/items", json=payload, headers=auth_headers(token))
    r2 = client.post("/api/v1/items", json=payload, headers=auth_headers(token))
    assert r1.status_code == 201
    assert r2.status_code == 200  # replay, not duplicate
    assert r1.json()["id"] == r2.json()["id"] == item_id


def test_invalid_client_id_rejected(client):
    token, _ = register_and_login(client)
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "x", "id": "not-a-ulid"},
        headers=auth_headers(token),
    )
    assert r.status_code == 422
    assert r.json()["code"] == "invalid_id"


def test_media_kinds_rejected_until_media_phase(client):
    token, _ = register_and_login(client)
    for kind in ("image", "file"):
        r = client.post(
            "/api/v1/items",
            json={"kind": kind, "body": "cap"},
            headers=auth_headers(token),
        )
        assert r.status_code == 422
        assert r.json()["code"] == "unsupported_kind"


def test_body_over_256kb_rejected(client):
    token, _ = register_and_login(client)
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "a" * (262144 + 1)},
        headers=auth_headers(token),
    )
    assert r.status_code == 413
    assert r.json()["code"] == "item_too_large"


def test_items_require_auth(client):
    assert (
        client.post("/api/v1/items", json={"kind": "text", "body": "x"}).status_code
        == 401
    )


def test_target_device_id_persisted_and_echoed(client):
    token, device_id = register_and_login(client)
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "targeted", "target_device_id": device_id},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    assert r.json()["target_device_id"] == device_id


def test_target_device_id_unknown_device_rejected(client):
    token, _ = register_and_login(client)
    r = client.post(
        "/api/v1/items",
        json={
            "kind": "text",
            "body": "x",
            "target_device_id": "01AAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        headers=auth_headers(token),
    )
    assert r.status_code == 422
    assert r.json()["code"] == "unknown_device"


def test_target_device_id_revoked_device_rejected(client):
    token, device_id = register_and_login(client)
    # Revoke the device
    client.delete(f"/api/v1/devices/{device_id}", headers=auth_headers(token))
    # Login again with a new device
    token2, _ = register_and_login(client, device_name="device2")
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "x", "target_device_id": device_id},
        headers=auth_headers(token2),
    )
    assert r.status_code == 422
    assert r.json()["code"] == "unknown_device"


# ---------------------------------------------------------------------------
# Finding 1: cross-user ULID collision → must 422 id_conflict, not 500
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


def test_cross_user_ulid_collision_returns_422(multi_user_client):
    """User B posting the same explicit ULID that user A already holds → 422 id_conflict."""
    c = multi_user_client
    shared_id = str(ULID())

    token_a, _ = register_and_login(
        c, email="alice@example.com", password="alice-pw1!", device_name="alice-device"
    )
    token_b, _ = register_and_login(
        c, email="bob@example.com", password="bob-pw1!", device_name="bob-device"
    )

    # User A creates item with explicit ULID — must succeed
    r_a = c.post(
        "/api/v1/items",
        json={"kind": "text", "body": "alice-content", "id": shared_id},
        headers=auth_headers(token_a),
    )
    assert r_a.status_code == 201
    assert r_a.json()["body"] == "alice-content"

    # User B posts the same ULID — must return 422 id_conflict, not 500
    r_b = c.post(
        "/api/v1/items",
        json={"kind": "text", "body": "bob-content", "id": shared_id},
        headers=auth_headers(token_b),
    )
    assert r_b.status_code == 422
    assert r_b.json()["code"] == "id_conflict"
    # Must not leak alice's item content
    assert "alice-content" not in str(r_b.json())

    # User A's item is unchanged
    r_check = c.get(f"/api/v1/items/{shared_id}", headers=auth_headers(token_a))
    # GET not yet implemented — verify via creating again (idempotent replay)
    r_replay = c.post(
        "/api/v1/items",
        json={"kind": "text", "body": "alice-content", "id": shared_id},
        headers=auth_headers(token_a),
    )
    assert r_replay.status_code == 200  # idempotent replay
    assert r_replay.json()["body"] == "alice-content"


# ---------------------------------------------------------------------------
# Finding 2: replay with differing payload must return EXISTING item unchanged
# ---------------------------------------------------------------------------


def test_idempotent_replay_differing_payload_returns_original(client):
    """POST id X body 'original' → 201; POST id X body 'changed' → 200 with 'original'."""
    token, _ = register_and_login(client)
    item_id = str(ULID())

    r1 = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "original", "id": item_id},
        headers=auth_headers(token),
    )
    assert r1.status_code == 201
    assert r1.json()["body"] == "original"

    r2 = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": "changed", "id": item_id},
        headers=auth_headers(token),
    )
    assert r2.status_code == 200
    assert r2.json()["body"] == "original"  # existing item returned unchanged
    assert r2.json()["id"] == item_id
