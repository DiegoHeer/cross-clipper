from crossclipper.config import Settings
from crossclipper.main import create_app
from fastapi.testclient import TestClient


def test_first_registration_succeeds_then_locks(client):
    r = client.post("/api/v1/auth/register",
                    json={"email": "me@example.com", "password": "hunter22!"})
    assert r.status_code == 201
    assert "user_id" in r.json()

    r2 = client.post("/api/v1/auth/register",
                     json={"email": "two@example.com", "password": "hunter22!"})
    assert r2.status_code == 403
    assert r2.json() == {"code": "registration_closed",
                         "message": "registration is closed on this server"}


def test_allow_registration_flag_reopens(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path, allow_registration=True))
    with TestClient(app) as c:
        assert c.post("/api/v1/auth/register",
                      json={"email": "a@x.y", "password": "hunter22!"}).status_code == 201
        assert c.post("/api/v1/auth/register",
                      json={"email": "b@x.y", "password": "hunter22!"}).status_code == 201


def test_duplicate_email_conflicts(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path, allow_registration=True))
    with TestClient(app) as c:
        c.post("/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"})
        r = c.post("/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"})
    assert r.status_code == 409
    assert r.json()["code"] == "email_taken"


def test_validation_errors_use_structured_shape(client):
    r = client.post("/api/v1/auth/register", json={"email": "me@example.com"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "password" in body["message"]


def test_old_client_version_rejected(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path, min_client_version="1.0.0"))
    with TestClient(app) as c:
        r = c.get("/health", headers={"X-Client-Version": "0.9.0"})
        assert r.status_code == 426
        assert r.json()["code"] == "client_too_old"
        assert c.get("/health", headers={"X-Client-Version": "1.0.0"}).status_code == 200
        assert c.get("/health").status_code == 200  # no header → lenient
