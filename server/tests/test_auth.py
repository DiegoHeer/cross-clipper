from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from crossclipper.config import Settings
from crossclipper.db.models import AuthToken, Device
from crossclipper.main import create_app


def test_first_registration_succeeds_then_locks(client):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "me@example.com", "password": "hunter22!"},
    )
    assert r.status_code == 201
    assert "user_id" in r.json()

    r2 = client.post(
        "/api/v1/auth/register",
        json={"email": "two@example.com", "password": "hunter22!"},
    )
    assert r2.status_code == 403
    assert r2.json() == {
        "code": "registration_closed",
        "message": "registration is closed on this server",
    }


def test_allow_registration_flag_reopens(tmp_path):
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        assert (
            c.post(
                "/api/v1/auth/register",
                json={"email": "a@x.y", "password": "hunter22!"},
            ).status_code
            == 201
        )
        assert (
            c.post(
                "/api/v1/auth/register",
                json={"email": "b@x.y", "password": "hunter22!"},
            ).status_code
            == 201
        )


def test_duplicate_email_conflicts(tmp_path):
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        c.post(
            "/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"}
        )
        r = c.post(
            "/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"}
        )
    assert r.status_code == 409
    assert r.json()["code"] == "email_taken"


def test_validation_errors_use_structured_shape(client):
    r = client.post("/api/v1/auth/register", json={"email": "me@example.com"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "password" in body["message"]


# ---------------------------------------------------------------------------
# FINDING-1: password byte-length cap (72 UTF-8 bytes, bcrypt hard limit)
# ---------------------------------------------------------------------------


def test_register_73_byte_ascii_password_returns_422(tmp_path):
    """73 ASCII bytes exceeds the bcrypt 72-byte limit → must yield 422, not 500."""
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        r = c.post(
            "/api/v1/auth/register",
            json={"email": "long@example.com", "password": "a" * 73},
        )
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "72" in body["message"]


def test_register_multibyte_password_over_72_bytes_returns_422(tmp_path):
    """40 × 'é' = 40 chars but 80 UTF-8 bytes → must yield 422 (char count passes max_length=72)."""
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        r = c.post(
            "/api/v1/auth/register",
            json={"email": "multi@example.com", "password": "é" * 40},
        )
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "72" in body["message"]


def test_register_exactly_72_byte_password_succeeds(tmp_path):
    """Exactly 72 ASCII bytes is the boundary — must succeed with 201."""
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        r = c.post(
            "/api/v1/auth/register",
            json={"email": "boundary@example.com", "password": "a" * 72},
        )
    assert r.status_code == 201


def test_login_with_over_72_byte_password_returns_422(tmp_path):
    """Login with a >72-byte password must yield 422, not 500 (bcrypt checkpw limit)."""
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    with TestClient(app) as c:
        # Register with a short valid password first.
        c.post(
            "/api/v1/auth/register",
            json={"email": "u@example.com", "password": "hunter22!"},
        )
        r = c.post(
            "/api/v1/auth/login",
            json={
                "email": "u@example.com",
                "password": "a" * 73,
                "device_name": "d",
                "platform": "other",
            },
        )
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "72" in body["message"]


def test_login_multibyte_password_over_72_bytes_returns_422(tmp_path):
    """40 × 'é' login password (80 UTF-8 bytes, 40 chars) → 422."""
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    with TestClient(app) as c:
        c.post(
            "/api/v1/auth/register",
            json={"email": "u@example.com", "password": "hunter22!"},
        )
        r = c.post(
            "/api/v1/auth/login",
            json={
                "email": "u@example.com",
                "password": "é" * 40,
                "device_name": "d",
                "platform": "other",
            },
        )
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert "72" in body["message"]


def test_integrity_error_on_race_returns_409(tmp_path):
    """Simulate registration race: get_by_email returns None for both requests,
    but the second create() hits the DB UNIQUE constraint (IntegrityError).
    Must return structured 409 {code: email_taken}, not a raw 500."""
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        # First registration succeeds normally.
        r1 = c.post(
            "/api/v1/auth/register", json={"email": "a@x.y", "password": "hunter22!"}
        )
        assert r1.status_code == 201

        # Patch get_by_email to return None so the pre-check is bypassed (simulates race).
        with patch("crossclipper.auth.repo.UserRepo.get_by_email", return_value=None):
            r2 = c.post(
                "/api/v1/auth/register",
                json={"email": "a@x.y", "password": "hunter22!"},
            )

    assert r2.status_code == 409
    assert r2.json()["code"] == "email_taken"


def test_old_client_version_rejected(tmp_path):
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, min_client_version="1.0.0")
    )
    with TestClient(app) as c:
        r = c.get("/health", headers={"X-Client-Version": "0.9.0"})
        assert r.status_code == 426
        assert r.json()["code"] == "client_too_old"
        assert (
            c.get("/health", headers={"X-Client-Version": "1.0.0"}).status_code == 200
        )
        assert c.get("/health").status_code == 200  # no header → lenient


from helpers import auth_headers, register_and_login


def test_login_returns_token_and_device(client):
    token, device_id = register_and_login(client)
    assert len(token) > 30
    assert device_id


def test_login_wrong_password_401(client):
    register_and_login(client)
    r = client.post(
        "/api/v1/auth/login",
        json={
            "email": "me@example.com",
            "password": "wrong-password",
            "device_name": "d",
            "platform": "other",
        },
    )
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_credentials"


def test_tokens_are_hashed_at_rest(client, app):
    from sqlalchemy.orm import Session

    from crossclipper.db.models import AuthToken

    token, _ = register_and_login(client)
    with Session(app.state.engine) as session:
        rows = list(session.scalars(select(AuthToken)))
    assert len(rows) == 1
    assert rows[0].token_hash != token
    assert len(rows[0].token_hash) == 64  # sha256 hex


def test_whoami_roundtrip_and_rejections(client):
    token, device_id = register_and_login(client)
    r = client.get("/api/v1/auth/whoami", headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["device_id"] == device_id

    assert client.get("/api/v1/auth/whoami").status_code == 401
    r = client.get("/api/v1/auth/whoami", headers=auth_headers("bogus"))
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"


# ---------------------------------------------------------------------------
# Tests for token expiry and device revocation — use /whoami as the protected
# probe route (already exists in production; no test-only route needed).
# ---------------------------------------------------------------------------


def test_expired_token_returns_401(tmp_path):
    """A token whose expires_at is in the past must yield 401."""
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    with TestClient(app) as c:
        token, _ = register_and_login(c)
        # Confirm token works before expiry.
        assert (
            c.get("/api/v1/auth/whoami", headers=auth_headers(token)).status_code == 200
        )

        # Fast-forward expires_at to the past directly in the DB.
        past = datetime(2000, 1, 1)
        with Session(app.state.engine) as session:
            session.execute(update(AuthToken).values(expires_at=past))
            session.commit()

        r = c.get("/api/v1/auth/whoami", headers=auth_headers(token))
        assert r.status_code == 401
        assert r.json()["code"] == "invalid_token"


def test_revoked_device_returns_401_other_device_still_works(tmp_path):
    """Revoking device A must 401 its token while device B's token stays valid."""
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        # Register once; login twice as two separate devices.
        c.post(
            "/api/v1/auth/register", json={"email": "u@x.y", "password": "hunter22!"}
        )
        r1 = c.post(
            "/api/v1/auth/login",
            json={
                "email": "u@x.y",
                "password": "hunter22!",
                "device_name": "device-A",
                "platform": "other",
            },
        )
        assert r1.status_code == 200
        token_a, device_id_a = r1.json()["token"], r1.json()["device_id"]

        r2 = c.post(
            "/api/v1/auth/login",
            json={
                "email": "u@x.y",
                "password": "hunter22!",
                "device_name": "device-B",
                "platform": "other",
            },
        )
        assert r2.status_code == 200
        token_b = r2.json()["token"]

        # Both tokens work.
        assert (
            c.get("/api/v1/auth/whoami", headers=auth_headers(token_a)).status_code
            == 200
        )
        assert (
            c.get("/api/v1/auth/whoami", headers=auth_headers(token_b)).status_code
            == 200
        )

        # Revoke device A directly in the DB.
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with Session(app.state.engine) as session:
            session.execute(
                update(Device).where(Device.id == device_id_a).values(revoked_at=now)
            )
            session.commit()

        # Device A token now 401s; device B is unaffected.
        r = c.get("/api/v1/auth/whoami", headers=auth_headers(token_a))
        assert r.status_code == 401
        assert r.json()["code"] == "invalid_token"

        assert (
            c.get("/api/v1/auth/whoami", headers=auth_headers(token_b)).status_code
            == 200
        )
