import pytest

from helpers import auth_headers, register_and_login


def test_list_shows_logged_in_devices(client):
    token, device_id = register_and_login(client, device_name="laptop")
    register_and_login(client, device_name="phone")
    r = client.get("/api/v1/devices", headers=auth_headers(token))
    assert r.status_code == 200
    devices = r.json()["devices"]
    assert {d["name"] for d in devices} == {"laptop", "phone"}
    me = next(d for d in devices if d["id"] == device_id)
    assert me["platform"] == "other"
    assert me["last_seen_at"] and me["created_at"]


def test_rename_device(client):
    token, device_id = register_and_login(client)
    r = client.patch(f"/api/v1/devices/{device_id}",
                     json={"name": "renamed"}, headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"


def test_rename_unknown_device_404(client):
    token, _ = register_and_login(client)
    r = client.patch("/api/v1/devices/nope", json={"name": "x"},
                     headers=auth_headers(token))
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


def test_revoke_kills_exactly_that_devices_token(client):
    token_a, device_a = register_and_login(client, device_name="a")
    token_b, device_b = register_and_login(client, device_name="b")

    r = client.delete(f"/api/v1/devices/{device_b}", headers=auth_headers(token_a))
    assert r.status_code == 204
    # revoked device's token is dead...
    assert client.get("/api/v1/devices", headers=auth_headers(token_b)).status_code == 401
    # ...the other device is untouched, and the revoked one left the list
    r = client.get("/api/v1/devices", headers=auth_headers(token_a))
    assert r.status_code == 200
    assert [d["id"] for d in r.json()["devices"]] == [device_a]


# ---------------------------------------------------------------------------
# Finding 2: double-revoke guard
# ---------------------------------------------------------------------------

def test_double_revoke_returns_404(client):
    """Second DELETE on an already-revoked device must return 404 not_found."""
    token, device_id = register_and_login(client)
    # first revoke — must succeed
    r = client.delete(f"/api/v1/devices/{device_id}", headers=auth_headers(token))
    assert r.status_code == 204
    # second revoke — must 404 without overwriting revoked_at
    # (use a fresh token from a second device so we're still authenticated)
    token2, _ = register_and_login(client, device_name="second-device")
    r2 = client.delete(f"/api/v1/devices/{device_id}", headers=auth_headers(token2))
    assert r2.status_code == 404
    assert r2.json()["code"] == "not_found"


# ---------------------------------------------------------------------------
# Finding 1: cross-user isolation
# ---------------------------------------------------------------------------

@pytest.fixture
def multi_user_client(tmp_path):
    """App with allow_registration=True so two real users can register."""
    from crossclipper.config import Settings
    from crossclipper.main import create_app
    from fastapi.testclient import TestClient

    settings = Settings(secret_key="test-secret", data_dir=tmp_path,
                        allow_registration=True)
    with TestClient(create_app(settings)) as c:
        yield c


def test_cross_user_device_isolation(multi_user_client):
    """User A cannot see, rename, or revoke user B's device."""
    c = multi_user_client

    token_a, device_a = register_and_login(
        c, email="alice@example.com", password="alice-pw1!", device_name="alice-device")
    token_b, device_b = register_and_login(
        c, email="bob@example.com", password="bob-pw1!", device_name="bob-device")

    # A's list must NOT contain B's device
    r = c.get("/api/v1/devices", headers=auth_headers(token_a))
    assert r.status_code == 200
    ids_seen_by_a = [d["id"] for d in r.json()["devices"]]
    assert device_b not in ids_seen_by_a, "user A must not see user B's device"
    assert device_a in ids_seen_by_a

    # A PATCH on B's device_id → 404 (no existence leak)
    r = c.patch(f"/api/v1/devices/{device_b}",
                json={"name": "hacked"}, headers=auth_headers(token_a))
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"

    # A DELETE on B's device_id → 404
    r = c.delete(f"/api/v1/devices/{device_b}", headers=auth_headers(token_a))
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"

    # B's device is untouched: token still works, name unchanged
    r = c.get("/api/v1/devices", headers=auth_headers(token_b))
    assert r.status_code == 200
    bob_device = next(d for d in r.json()["devices"] if d["id"] == device_b)
    assert bob_device["name"] == "bob-device"
