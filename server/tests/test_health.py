from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"


def test_health_reports_unwritable_blob_dir(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    (tmp_path / "blobs").chmod(0o500)
    try:
        with TestClient(app) as c:
            r = c.get("/health")
        assert r.status_code == 503
        assert r.json()["code"] == "unhealthy"
    finally:
        (tmp_path / "blobs").chmod(0o700)


def test_health_reports_identity_and_open_registration(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["app"] == "crossclipper"
    assert body["version"]  # non-empty, e.g. "0.1.0"
    assert body["registration_open"] is True  # fresh DB: no user yet


def test_health_registration_closes_after_first_user(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "a@b.c", "password": "password123!"},
    )
    assert client.get("/health").json()["registration_open"] is False
