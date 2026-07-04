from fastapi.testclient import TestClient
from helpers import register_and_login

from crossclipper.auth.ratelimit import RateLimiter
from crossclipper.config import Settings
from crossclipper.main import create_app


def test_rate_limiter_sliding_window():
    clock = {"t": 0.0}
    rl = RateLimiter(max_events=3, window_seconds=10, now=lambda: clock["t"])
    assert all(rl.allow("k") for _ in range(3))
    assert rl.allow("k") is False
    assert rl.allow("other-key") is True  # keys are independent
    clock["t"] = 10.1
    assert rl.allow("k") is True  # window slid


def test_login_rate_limited_after_10_attempts(client):
    register_and_login(client)  # 1 successful login consumes 1 slot
    bad = {
        "email": "me@example.com",
        "password": "wrong-password",
        "device_name": "d",
        "platform": "other",
    }
    for _ in range(9):
        assert client.post("/api/v1/auth/login", json=bad).status_code == 401
    r = client.post("/api/v1/auth/login", json=bad)
    assert r.status_code == 429
    assert r.json()["code"] == "rate_limited"


def test_register_rate_limited_after_10_attempts(tmp_path):
    """The /register endpoint is rate-limited independently of /login.

    Each call to /register consumes one slot in the ``register`` bucket
    regardless of whether it succeeds (201), conflicts (409), or is refused
    (403).  After 10 attempts the 11th must return 429 rate_limited.
    """
    app = create_app(
        Settings(secret_key="t", data_dir=tmp_path, allow_registration=True)
    )
    with TestClient(app) as c:
        payload = {"email": "u@example.com", "password": "hunter22!"}
        # First call registers successfully (201); subsequent 9 hit 409
        # (email already taken) — all consume a rate-limit slot.
        for _ in range(10):
            status = c.post("/api/v1/auth/register", json=payload).status_code
            assert status in (201, 409)
        r = c.post("/api/v1/auth/register", json=payload)
        assert r.status_code == 429
        assert r.json()["code"] == "rate_limited"
