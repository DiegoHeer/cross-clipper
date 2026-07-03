"""Tests for the framework-level error spine (404/405/500 handlers)."""

import pytest
from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(secret_key="t", data_dir=tmp_path))


def test_unknown_route_returns_404_with_code_message(app):
    with TestClient(app) as c:
        r = c.get("/no/such/route")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "not_found"
    assert "message" in body


def test_wrong_method_returns_405_with_code_message(app):
    # /health exists as GET; POST should yield 405
    with TestClient(app) as c:
        r = c.post("/health")
    assert r.status_code == 405
    body = r.json()
    assert body["code"] == "method_not_allowed"
    assert "message" in body


def test_unhandled_exception_returns_500_with_code_message_no_leak(tmp_path):
    """A route that throws an unhandled exception must return the error spine
    shape without leaking exception details."""
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))

    @app.get("/_test_explode")
    async def _explode():
        raise RuntimeError("secret internals must not leak")

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/_test_explode")
    assert r.status_code == 500
    body = r.json()
    assert body["code"] == "internal_error"
    assert body["message"] == "internal server error"
    # The raw exception text must not appear in the response
    assert "secret" not in r.text
    assert "internals" not in r.text
