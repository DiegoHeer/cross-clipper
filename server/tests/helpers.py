"""Shared test helpers importable as `from helpers import ...`."""


def register_and_login(client, email="me@example.com", password="hunter22!",
                       device_name="test-device", platform="other"):
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code in (201, 403, 409)  # ok if user already exists
    r = client.post("/api/v1/auth/login", json={
        "email": email, "password": password,
        "device_name": device_name, "platform": platform})
    assert r.status_code == 200, r.text
    data = r.json()
    return data["token"], data["device_id"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}
