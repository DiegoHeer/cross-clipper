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
