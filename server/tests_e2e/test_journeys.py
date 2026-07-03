"""E2E journey tests — Layer A.

Journeys run against a REAL uvicorn subprocess over real sockets.
Each journey is a single test function so pytest -m e2e gives clear per-journey
pass/fail output.

Journey 1 uses a function-scoped `first_run_server` (fresh, empty data dir) so
it can genuinely test the first-run registration flow.  Journeys 2 and 4 use
the session-scoped `server`; the session-scoped `_ensure_session_user` autouse
fixture registers the shared user before any test runs, making those journeys
independently executable.

Journey 3 (live WS events) arrives with the WS journeys (later PR).
Journey 5 uses its own function-scoped `restart_server` to safely kill-and-restart.
"""

from __future__ import annotations

import httpx
import pytest

from tests_e2e.conftest import (
    _SESSION_EMAIL as _EMAIL,
)
from tests_e2e.conftest import (
    _SESSION_PASSWORD as _PASSWORD,
)
from tests_e2e.conftest import (
    ServerInfo,
    _start_server,
    _stop_server,
    _wait_healthy,
    _wait_port_free,
)

# ---------------------------------------------------------------------------
# Shared credentials — used across journeys 1, 2, 4
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(
    base_url: str,
    device_name: str,
    platform: str = "other",
    email: str = _EMAIL,
    password: str = _PASSWORD,
) -> tuple[str, str]:
    """Login and return (token, device_id)."""
    r = httpx.post(
        f"{base_url}/api/v1/auth/login",
        json={
            "email": email,
            "password": password,
            "device_name": device_name,
            "platform": platform,
        },
    )
    assert r.status_code == 200, f"login failed: {r.text}"
    data = r.json()
    return data["token"], data["device_id"]


# ---------------------------------------------------------------------------
# Journey 1 — First-run
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_journey_first_run(first_run_server: ServerInfo) -> None:
    """
    Register → second register 403 → login two devices → GET /devices shows both.

    Uses its own function-scoped server so it always runs against a truly fresh
    instance, regardless of test execution order.
    """
    base = first_run_server.base_url

    # 1a. First registration succeeds
    r = httpx.post(
        f"{base}/api/v1/auth/register",
        json={"email": _EMAIL, "password": _PASSWORD},
    )
    assert r.status_code == 201, f"first register failed: {r.text}"
    assert "user_id" in r.json()

    # 1b. Second registration is forbidden (user already exists, single-user policy)
    r2 = httpx.post(
        f"{base}/api/v1/auth/register",
        json={"email": "other@example.com", "password": _PASSWORD},
    )
    assert r2.status_code == 403, f"expected 403, got {r2.status_code}: {r2.text}"

    # 1c. Login device A
    token_a, device_id_a = _login(base, "J1-Device-A")

    # 1d. Login device B
    token_b, device_id_b = _login(base, "J1-Device-B")

    assert device_id_a != device_id_b

    # 1e. GET /devices from device A shows both (among possibly others from later runs)
    r = httpx.get(f"{base}/api/v1/devices", headers=_headers(token_a))
    assert r.status_code == 200, r.text
    devices = r.json()["devices"]
    ids = {d["id"] for d in devices}
    assert device_id_a in ids
    assert device_id_b in ids


# ---------------------------------------------------------------------------
# Journey 2 — Item lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_journey_item_lifecycle(server: ServerInfo) -> None:
    """
    Device A posts text + link, one targeted at device B.
    Device B cursor-pulls and sees all with target_device_id intact.
    Idempotent replay returns 200 with original body.
    Oversized body → 413.
    Unsupported kind → 422.
    """
    base = server.base_url

    # Login as two fresh devices for this journey
    token_a, device_id_a = _login(base, "J2-Device-A")
    token_b, device_id_b = _login(base, "J2-Device-B")

    # 2a. Post a plain text item (no target)
    r = httpx.post(
        f"{base}/api/v1/items",
        json={"kind": "text", "body": "hello world"},
        headers=_headers(token_a),
    )
    assert r.status_code == 201, r.text
    text_item = r.json()
    assert text_item["kind"] == "text"
    assert text_item["body"] == "hello world"
    assert text_item["origin_device_id"] == device_id_a
    assert text_item["target_device_id"] is None

    # 2b. Post a link item targeted at device B
    r = httpx.post(
        f"{base}/api/v1/items",
        json={
            "kind": "link",
            "body": "https://example.com",
            "target_device_id": device_id_b,
        },
        headers=_headers(token_a),
    )
    assert r.status_code == 201, r.text
    link_item = r.json()
    assert link_item["kind"] == "link"
    assert link_item["target_device_id"] == device_id_b

    # 2c. Device B pulls from cursor=None; items created by device A are visible
    r = httpx.get(f"{base}/api/v1/items", headers=_headers(token_b))
    assert r.status_code == 200, r.text
    page = r.json()
    item_ids = {i["id"] for i in page["items"]}
    assert text_item["id"] in item_ids
    assert link_item["id"] in item_ids

    # Verify target_device_id is preserved in pull
    fetched_link = next(i for i in page["items"] if i["id"] == link_item["id"])
    assert fetched_link["target_device_id"] == device_id_b

    # 2d. Idempotent replay: re-post text item with same id → 200, original body
    r = httpx.post(
        f"{base}/api/v1/items",
        json={"kind": "text", "body": "hello world", "id": text_item["id"]},
        headers=_headers(token_a),
    )
    assert r.status_code == 200, (
        f"expected 200 idempotent replay, got {r.status_code}: {r.text}"
    )
    replayed = r.json()
    assert replayed["id"] == text_item["id"]
    assert replayed["body"] == "hello world"

    # 2e. Oversized body → 413
    big_body = "x" * (262144 + 1)  # default item_max_bytes is 262144
    r = httpx.post(
        f"{base}/api/v1/items",
        json={"kind": "text", "body": big_body},
        headers=_headers(token_a),
        timeout=10.0,
    )
    assert r.status_code == 413, f"expected 413 for oversized body, got {r.status_code}"

    # 2f. Unsupported kind → 422
    r = httpx.post(
        f"{base}/api/v1/items",
        json={"kind": "image", "body": "fake-image-data"},
        headers=_headers(token_a),
    )
    assert r.status_code == 422, (
        f"expected 422 for unsupported kind, got {r.status_code}"
    )
    assert r.json()["code"] == "unsupported_kind"


# ---------------------------------------------------------------------------
# Journey 4 — Revocation (REST half)
# TODO: WS-close half arrives with the WS journeys (later PR).
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_journey_revocation_rest(server: ServerInfo) -> None:
    """
    Revoke device B → B's REST requests return 401 → A is unaffected.

    WS-close half: TODO — verify B's open WS connection is closed on revocation.
    This will be added in the WS journeys PR.
    """
    base = server.base_url

    # Login as two fresh devices for this journey
    token_a, device_id_a = _login(base, "J4-Device-A")
    token_b, device_id_b = _login(base, "J4-Device-B")

    # Pre-condition: both can access /devices
    r = httpx.get(f"{base}/api/v1/devices", headers=_headers(token_a))
    assert r.status_code == 200
    r = httpx.get(f"{base}/api/v1/devices", headers=_headers(token_b))
    assert r.status_code == 200

    # Revoke device B (from device A)
    r = httpx.delete(
        f"{base}/api/v1/devices/{device_id_b}",
        headers=_headers(token_a),
    )
    assert r.status_code == 204, f"revoke failed: {r.status_code} {r.text}"

    # Device B's REST request returns 401
    r = httpx.get(f"{base}/api/v1/devices", headers=_headers(token_b))
    assert r.status_code == 401, (
        f"expected 401 for revoked device B, got {r.status_code}"
    )

    # Device A is unaffected
    r = httpx.get(f"{base}/api/v1/devices", headers=_headers(token_a))
    assert r.status_code == 200, (
        f"device A affected after B revocation: {r.status_code}"
    )


# ---------------------------------------------------------------------------
# Journey 5 — Server-kill recovery drill
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_journey_server_kill_recovery(restart_server: ServerInfo) -> None:
    """
    Post items, record cursor, TERMINATE the server, restart on same port/data,
    pull from recorded cursor → no items lost, no duplicates.
    """
    base = restart_server.base_url
    port = restart_server.port
    data_dir = restart_server.data_dir
    proc = restart_server.proc

    # This server is fresh — register the user first
    r = httpx.post(
        f"{base}/api/v1/auth/register",
        json={"email": _EMAIL, "password": _PASSWORD},
    )
    assert r.status_code == 201, r.text

    token, _ = _login(base, "Recovery-Device")

    # Post some items
    item_ids = []
    for i in range(3):
        r = httpx.post(
            f"{base}/api/v1/items",
            json={"kind": "text", "body": f"item-{i}"},
            headers=_headers(token),
        )
        assert r.status_code == 201, r.text
        item_ids.append(r.json()["id"])

    # Pull with cursor=None to get all items and record the last cursor
    r = httpx.get(f"{base}/api/v1/items", headers=_headers(token))
    assert r.status_code == 200, r.text
    first_page = r.json()
    assert len(first_page["items"]) == 3
    cursor = first_page["items"][-1]["id"]

    # Kill the server (SIGTERM, then wait)
    _stop_server(proc)

    # Wait until the OS actually frees the port before rebinding.
    _wait_port_free(restart_server.port)

    # Restart on the SAME port and SAME data dir
    new_proc = _start_server(port, data_dir)
    try:
        _wait_healthy(base)

        # Pull from the recorded cursor — should see no items (nothing new posted)
        r = httpx.get(
            f"{base}/api/v1/items",
            params={"cursor": cursor},
            headers=_headers(token),
        )
        assert r.status_code == 200, f"pull after restart failed: {r.text}"
        after_restart = r.json()
        assert after_restart["items"] == [], (
            f"expected no new items after cursor, got {after_restart['items']}"
        )

        # Pull from beginning — all original items still present, no duplicates
        r = httpx.get(f"{base}/api/v1/items", headers=_headers(token))
        assert r.status_code == 200, r.text
        full_page = r.json()
        recovered_ids = [i["id"] for i in full_page["items"]]
        assert len(recovered_ids) == len(set(recovered_ids)), (
            "duplicates found after restart"
        )
        for item_id in item_ids:
            assert item_id in recovered_ids, f"item {item_id} lost after restart"

    finally:
        _stop_server(new_proc)
