"""Layer B — Schemathesis contract fuzzing.

Runs against a REAL uvicorn subprocess (base-URL mode, not ASGI mode).
Schema loaded from the committed ``packages/core/openapi.json``.

Checks
------
Only ``not_a_server_error`` is enabled (catches any 5xx).
``response_schema_conformance`` is intentionally excluded: the OpenAPI schema
does not declare 401 / 403 / 409 / 422 / 429 on every endpoint that can
produce them (the spec was written for clients, not exhaustive contract
documentation), so conformance checks would produce false positives.

Rate limiting
-------------
The server applies a hard-coded 10 req/60 s per-IP limit on
``POST /api/v1/auth/login`` and ``POST /api/v1/auth/register``.  With
``max_examples=15`` the fuzz session makes at most ~15 calls per operation;
a 429 response is NOT a 5xx so it passes ``not_a_server_error`` cleanly.
This is the deliberate design: 429 is acceptable noise, not a finding.

Auth
----
A session-scoped fixture registers a user on the fuzz server and logs in a
dedicated fuzz device to obtain a bearer token.  A ``map_headers`` hook on
the schema injects ``Authorization: Bearer <token>`` on every generated
request.  This exercises the authenticated code paths.  Endpoints that do
not require auth (``/health``, ``/api/v1/auth/register``) simply receive an
extra header that the server ignores.

FINDING-1 (FIXED)
-----------------
``POST /api/v1/auth/register`` previously returned 500 when ``password``
length exceeded 72 UTF-8 bytes (bcrypt hard limit).  Fixed by:
  - Capping ``RegisterIn.password`` ``max_length`` to 72 (contract cap).
  - Adding a Pydantic byte-length validator on both ``RegisterIn`` and
    ``LoginIn`` that rejects passwords whose UTF-8 encoding exceeds 72 bytes
    (covers multibyte characters that pass the character-count cap).
  - Adding a belt-and-braces ``ValueError`` catch in ``hash_password()`` that
    raises ``AppError(422)`` in case a future call site bypasses the schema.
The xfail guards have been removed; over-long passwords now reliably return 422.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import schemathesis
import schemathesis.openapi
from schemathesis.config import SchemathesisConfig

from tests_e2e.conftest import (
    _SESSION_EMAIL,
    _SESSION_PASSWORD,
    ServerInfo,
    _free_port,
    _start_server,
    _stop_server,
    _wait_healthy,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Path to the committed OpenAPI contract (source of truth for fuzzing).
_OPENAPI_PATH = (
    Path(__file__).parent.parent.parent / "packages" / "core" / "openapi.json"
)

# Examples generated per operation.  15 × ~10 operations ≈ 150 HTTP calls;
# locally that takes ~30–60 s; in CI with the subprocess overhead ~2 min.
_MAX_EXAMPLES = 15


# ---------------------------------------------------------------------------
# Fuzz-server fixture (session-scoped, independent from the journey server)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def fuzz_server(tmp_path_factory: pytest.TempPathFactory) -> ServerInfo:  # type: ignore[type-arg]
    """Boot a dedicated uvicorn server for fuzz tests; tear down at session end."""
    data_dir = tmp_path_factory.mktemp("fuzz_data")
    port = _free_port()
    # CC_ALLOW_REGISTRATION=true so the fuzz fixture can register freely.
    proc = _start_server(port, data_dir, extra_env={"CC_ALLOW_REGISTRATION": "true"})
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_healthy(base_url)
        yield ServerInfo(base_url=base_url, port=port, data_dir=data_dir, proc=proc)
    finally:
        _stop_server(proc)


# ---------------------------------------------------------------------------
# Auth fixture — obtains bearer token for the fuzz session
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def fuzz_bearer_token(fuzz_server: ServerInfo) -> str:
    """Register the shared user and log in a fuzz device; return the bearer token."""
    base = fuzz_server.base_url

    r = httpx.post(
        f"{base}/api/v1/auth/register",
        json={"email": _SESSION_EMAIL, "password": _SESSION_PASSWORD},
    )
    # 201 = created; 403/409 = already exists (idempotent across reruns)
    assert r.status_code in (201, 403, 409), (
        f"fuzz register failed: {r.status_code} {r.text}"
    )

    r = httpx.post(
        f"{base}/api/v1/auth/login",
        json={
            "email": _SESSION_EMAIL,
            "password": _SESSION_PASSWORD,
            "device_name": "fuzz-device",
            "platform": "other",
        },
    )
    assert r.status_code == 200, f"fuzz login failed: {r.status_code} {r.text}"
    return str(r.json()["token"])


# ---------------------------------------------------------------------------
# Schema fixture — loaded from the committed contract with live base URL
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def fuzz_schema(fuzz_server: ServerInfo, fuzz_bearer_token: str):
    """Return a Schemathesis schema pointed at the live fuzz server."""
    with open(_OPENAPI_PATH) as f:
        raw = json.load(f)

    config = SchemathesisConfig.from_dict(
        {
            "base-url": fuzz_server.base_url,
            # Fixed seed at top level (seed is a SchemathesisConfig field, not a
            # generation sub-key) for reproducible CI runs.
            "seed": 12345,
            "generation": {"max-examples": _MAX_EXAMPLES},
        }
    )
    schema = schemathesis.openapi.from_dict(raw, config=config)

    # Inject auth header on every generated request via map_headers (schema scope).
    # before_call is GLOBAL scope only; map_headers works at all scopes.
    @schema.hook("map_headers")
    def inject_auth(ctx, headers):  # noqa: ANN001, ANN202
        if headers is None:
            headers = {}
        headers["Authorization"] = f"Bearer {fuzz_bearer_token}"
        return headers

    return schema


# ---------------------------------------------------------------------------
# Fuzz test
# ---------------------------------------------------------------------------

_schema = schemathesis.pytest.from_fixture("fuzz_schema")


@_schema.parametrize()
@pytest.mark.fuzz
def test_contract_fuzz(case) -> None:  # noqa: ANN001
    """Fuzz every API operation; fail on any 5xx response.

    The only active check is ``not_a_server_error``.  See module docstring for
    the rationale on excluding response-schema conformance checks.

    FINDING-1 is fixed: the contract now caps passwords at 72 characters and a
    Pydantic validator rejects passwords exceeding 72 UTF-8 bytes, so the fuzz
    engine cannot generate a password that causes bcrypt to crash.
    """
    from schemathesis.checks import not_a_server_error

    response = case.call()
    case.validate_response(response, checks=[not_a_server_error])


# ---------------------------------------------------------------------------
# Deterministic regression test for FINDING-1 (fixed)
# ---------------------------------------------------------------------------
# Ensures the fix holds: a >72-byte password returns 422, never 500.


@pytest.mark.fuzz
def test_register_password_over_72_bytes_returns_422(fuzz_server: ServerInfo) -> None:
    """FINDING-1 regression: a 73-byte password must return 422, not 500.

    Previously the server crashed with 500 (bcrypt ValueError).  Fixed by
    capping the contract at maxLength=72 and adding a Pydantic byte-length
    validator.  This deterministic probe ensures the fix is permanent.
    """
    password = "a" * 73  # 73 ASCII bytes → exactly one over the bcrypt limit
    r = httpx.post(
        f"{fuzz_server.base_url}/api/v1/auth/register",
        json={"email": "finding1@example.com", "password": password},
    )
    assert r.status_code == 422, (
        f"FINDING-1 regression: expected 422 for over-long password, "
        f"got {r.status_code} {r.text}"
    )
    assert r.json().get("code") == "validation_error"
