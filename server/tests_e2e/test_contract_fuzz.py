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

Known findings (xfail — do NOT fix here, tracked for triage)
-------------------------------------------------------------
FINDING-1: ``POST /api/v1/auth/register`` returns 500 when ``password``
length is ≥ 73 bytes.  Root cause: ``bcrypt.hashpw`` raises ``ValueError``
("password cannot be longer than 72 bytes") because the server does not
validate password length before hashing, and the exception is not caught by
the error handlers.  Fix: validate ``len(password.encode()) <= 72`` in the
register endpoint (or the schema's ``maxLength=128`` should be reduced to
72, or the error caught and converted to 422).  Reproduce:

    curl -X POST -H 'Content-Type: application/json' \\
         -d '{"email": "test@example.com", "password": "' + ('0' * 73) + '"}' \\
         http://<server>/api/v1/auth/register
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

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


def _password_over_72_bytes(case: Any) -> bool:  # noqa: ANN401
    """Return True when the generated body contains a password that exceeds 72 UTF-8 bytes.

    Guards against absent body, non-dict body, missing/non-string password field.
    """
    body = getattr(case, "body", None)
    if not isinstance(body, dict):
        return False
    password = body.get("password")
    if not isinstance(password, str):
        return False
    return len(password.encode()) > 72


@_schema.parametrize()
@pytest.mark.fuzz
def test_contract_fuzz(case) -> None:  # noqa: ANN001
    """Fuzz every API operation; fail on any 5xx response.

    The only active check is ``not_a_server_error``.  See module docstring for
    the rationale on excluding response-schema conformance checks.

    FINDING-1 (xfail): POST /api/v1/auth/register crashes with 500 when the
    password body is ≥ 73 bytes.  Marked xfail ONLY when that specific condition
    holds — other register inputs still go through normal validation.
    See the module docstring for details.
    """
    from schemathesis.checks import not_a_server_error

    response = case.call()

    # FINDING-1: register endpoint crashes on passwords > 72 bytes (bcrypt limit).
    # xfail only when the specific tolerated condition holds; all other register
    # responses still go through not_a_server_error validation below.
    if (
        case.operation.label == "POST /api/v1/auth/register"
        and response.status_code == 500
        and _password_over_72_bytes(case)
    ):
        pytest.xfail(
            "FINDING-1: POST /api/v1/auth/register returns 500 on password "
            ">72 bytes — bcrypt ValueError not caught by error handlers. "
            "Tracked for triage; do not fix in this task."
        )

    case.validate_response(response, checks=[not_a_server_error])


# ---------------------------------------------------------------------------
# Deterministic regression case for FINDING-1
# ---------------------------------------------------------------------------
# Ensures FINDING-1 stays visibly tracked regardless of whether the fuzz corpus
# (seeded or not) happens to generate a >72-byte password in any given run.


@pytest.mark.fuzz
def test_register_password_over_72_bytes_xfail(fuzz_server: ServerInfo) -> None:
    """FINDING-1 regression: a 73-byte password triggers a 500 (bcrypt limit).

    This is a deterministic (non-fuzz-generated) probe so the finding is always
    visible even if the seeded corpus never produces a long-enough password.
    """
    password = "a" * 73  # 73 ASCII bytes → exactly one over the bcrypt limit
    r = httpx.post(
        f"{fuzz_server.base_url}/api/v1/auth/register",
        json={"email": "finding1@example.com", "password": password},
    )
    if r.status_code == 500:
        pytest.xfail(
            "FINDING-1: POST /api/v1/auth/register returns 500 on password "
            ">72 bytes — bcrypt ValueError not caught by error handlers. "
            "Tracked for triage; do not fix in this task."
        )
    # If the bug has been fixed (e.g. 422 returned), the test passes normally.
    assert r.status_code != 500, f"Unexpected non-500 failure: {r.status_code} {r.text}"
