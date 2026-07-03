from helpers import register_and_login

from crossclipper.auth.ratelimit import RateLimiter


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
