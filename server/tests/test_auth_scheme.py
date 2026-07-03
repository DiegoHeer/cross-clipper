"""Negative Authorization-scheme tests for require_auth.

Covers the header-parsing branch in auth/deps.py that is correct but untested:
split(None, 1) + case-insensitive scheme check. Each case must yield 401 with
the standard {code, message} error shape.
"""

import pytest
from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    with TestClient(app) as c:
        yield c


# /api/v1/auth/whoami is a protected route that doesn't require an existing
# user to exercise the auth header parsing — any malformed header is rejected
# before the token is looked up.
PROBE = "/api/v1/auth/whoami"


def _assert_invalid_token_401(r):
    assert r.status_code == 401
    body = r.json()
    assert body["code"] == "invalid_token"
    assert "message" in body


def test_missing_authorization_header_is_401(client):
    _assert_invalid_token_401(client.get(PROBE))


def test_basic_scheme_is_rejected_as_401(client):
    """Authorization: Basic xyz must be rejected — only Bearer is accepted."""
    _assert_invalid_token_401(client.get(PROBE, headers={"Authorization": "Basic xyz"}))


def test_bare_bearer_without_token_is_401(client):
    """Authorization: Bearer with no token part must be rejected."""
    _assert_invalid_token_401(client.get(PROBE, headers={"Authorization": "Bearer"}))


def test_bearer_case_insensitive_accepted_when_token_valid(tmp_path):
    """Sanity check: the scheme comparison is case-insensitive.
    A valid token with mixed-case scheme header must succeed.
    """
    from helpers import register_and_login

    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    with TestClient(app) as c:
        token, _ = register_and_login(c)
        r = c.get(PROBE, headers={"Authorization": f"BEARER {token}"})
        assert r.status_code == 200
