"""E2E journey tests — Layer A.

Journeys run against a REAL uvicorn subprocess over real sockets.
Each journey is a single test function so pytest -m e2e gives clear per-journey
pass/fail output.

Journey 1 uses a function-scoped `first_run_server` (fresh, empty data dir) so
it can genuinely test the first-run registration flow.  Journeys 2, 3, and 4 use
the session-scoped `server`; the session-scoped `_ensure_session_user` autouse
fixture registers the shared user before any test runs, making those journeys
independently executable.

Journey 5 uses its own function-scoped `restart_server` to safely kill-and-restart.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import websockets

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
# Journey 3 — Live WS events
# ---------------------------------------------------------------------------

_WS_RECV_TIMEOUT = 5.0  # seconds — bounded receive; clear failure if exceeded


async def _ws_connect(ws_url: str) -> websockets.ClientConnection:
    """Open a WebSocket connection to the server."""
    return await websockets.connect(ws_url)


async def _recv_json(
    ws: websockets.ClientConnection, timeout: float = _WS_RECV_TIMEOUT
) -> dict:
    """Receive one JSON message; raises TimeoutError if nothing arrives in time."""
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    return json.loads(raw)


@pytest.mark.e2e
def test_journey_live_events(server: ServerInfo) -> None:
    """
    Journey 3 — Live WS events.

    Device B holds an open WS connection.
    Device A posts an item → B receives `item_new` with the full item incl. target_device_id.
    Device A deletes the item → B receives `item_deleted` with the item_id.
    A cursor re-pull over HTTP from B sees the tombstone.
    """

    async def _run() -> None:
        base = server.base_url
        port = server.port

        # Login as two fresh devices for this journey
        token_a, device_id_a = _login(base, "J3-Device-A")
        token_b, device_id_b = _login(base, "J3-Device-B")

        ws_url_b = f"ws://127.0.0.1:{port}/api/v1/ws?token={token_b}"

        async with websockets.connect(ws_url_b) as ws_b:
            # 3a. A posts a targeted item (targeted at B so target_device_id is set)
            r = httpx.post(
                f"{base}/api/v1/items",
                json={
                    "kind": "text",
                    "body": "live-event-test",
                    "target_device_id": device_id_b,
                },
                headers=_headers(token_a),
            )
            assert r.status_code == 201, f"post item failed: {r.text}"
            posted_item = r.json()
            item_id = posted_item["id"]

            # 3b. B receives `item_new` with full item
            event = await _recv_json(ws_b)
            assert event["type"] == "item_new", f"expected item_new, got {event!r}"
            received_item = event["item"]
            assert received_item["id"] == item_id, (
                f"item id mismatch: expected {item_id}, got {received_item['id']}"
            )
            assert received_item["body"] == "live-event-test"
            assert received_item["target_device_id"] == device_id_b, (
                f"expected target_device_id={device_id_b}, got {received_item['target_device_id']}"
            )

            # 3c. A deletes the item → B receives `item_deleted`
            r = httpx.delete(
                f"{base}/api/v1/items/{item_id}",
                headers=_headers(token_a),
            )
            assert r.status_code == 204, f"delete item failed: {r.text}"

            event = await _recv_json(ws_b)
            assert event["type"] == "item_deleted", (
                f"expected item_deleted, got {event!r}"
            )
            assert event["item_id"] == item_id, (
                f"item_id mismatch: expected {item_id}, got {event['item_id']}"
            )

        # 3d. Cursor re-pull from B over HTTP sees the tombstone (cursor pulls include deleted)
        r = httpx.get(
            f"{base}/api/v1/items",
            params={"cursor": "0" * 26},  # cursor before any item → full history
            headers=_headers(token_b),
        )
        assert r.status_code == 200, f"cursor pull failed: {r.text}"
        page = r.json()
        tombstoned = next((i for i in page["items"] if i["id"] == item_id), None)
        assert tombstoned is not None, (
            f"tombstone for {item_id} not found in cursor pull"
        )
        assert tombstoned["deleted_at"] is not None, (
            f"expected deleted_at set on tombstone, got {tombstoned['deleted_at']!r}"
        )

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Journey 4 — Revocation (REST + WS)
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_journey_revocation_rest(server: ServerInfo) -> None:
    """
    Journey 4 (REST half) — Revoke device B → B's REST requests return 401 → A is unaffected.
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


@pytest.mark.e2e
def test_journey_revocation_ws(server: ServerInfo) -> None:
    """
    Journey 4 (WS half) — B holds an open WS connection → revoke B → B's socket
    closes with code 4401 → A's WS still works (ping/pong).
    """

    async def _run() -> None:
        base = server.base_url
        port = server.port

        # Login as two fresh devices for this journey
        token_a, device_id_a = _login(base, "J4WS-Device-A")
        token_b, device_id_b = _login(base, "J4WS-Device-B")

        ws_url_a = f"ws://127.0.0.1:{port}/api/v1/ws?token={token_a}"
        ws_url_b = f"ws://127.0.0.1:{port}/api/v1/ws?token={token_b}"

        async with (
            websockets.connect(ws_url_a) as ws_a,
            websockets.connect(ws_url_b) as ws_b,
        ):
            # Verify A's connection works: ping → pong
            await ws_a.send(json.dumps({"type": "ping"}))
            pong = await _recv_json(ws_a)
            assert pong == {"type": "pong"}, f"expected pong, got {pong!r}"

            # Revoke device B (from A via HTTP) — run in a thread to avoid blocking the loop
            def _revoke() -> httpx.Response:
                return httpx.delete(
                    f"{base}/api/v1/devices/{device_id_b}",
                    headers=_headers(token_a),
                )

            r = await asyncio.to_thread(_revoke)
            assert r.status_code == 204, f"revoke failed: {r.status_code} {r.text}"

            # B's socket must close with code 4401
            try:
                # Drain until closed; any message before close is fine
                while True:
                    await asyncio.wait_for(ws_b.recv(), timeout=_WS_RECV_TIMEOUT)
            except websockets.exceptions.ConnectionClosedError as exc:
                assert exc.rcvd is not None and exc.rcvd.code == 4401, (
                    f"expected close code 4401, got {exc.rcvd!r}"
                )
            except websockets.exceptions.ConnectionClosedOK as exc:
                # Server may close with OK if it can't send close frames for custom codes
                # on some WS implementations — but we specifically test for 4401
                raise AssertionError(
                    f"expected close code 4401, got ConnectionClosedOK: {exc.rcvd!r}"
                )
            except asyncio.TimeoutError:
                raise AssertionError(
                    "B's WS was not closed within timeout after revocation"
                )

            # A's connection is still alive — ping → pong
            # Drain any pending broadcast events (e.g. device_changed) before sending ping
            await ws_a.send(json.dumps({"type": "ping"}))
            # Collect messages until we see a pong (skip intermediate broadcasts)
            deadline = asyncio.get_event_loop().time() + _WS_RECV_TIMEOUT
            pong2 = None
            while asyncio.get_event_loop().time() < deadline:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                msg = await asyncio.wait_for(ws_a.recv(), timeout=remaining)
                parsed = json.loads(msg)
                if parsed.get("type") == "pong":
                    pong2 = parsed
                    break
            assert pong2 == {"type": "pong"}, (
                f"A's WS broken after B revocation: expected pong, got {pong2!r}"
            )

    asyncio.run(_run())


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
