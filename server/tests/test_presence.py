"""Tests for live presence: Hub transition semantics and online flag in device list."""

from helpers import auth_headers, register_and_login

from crossclipper.realtime.hub import Hub

# ---------------------------------------------------------------------------
# Hub unit tests — fake-socket style (no network, no app)
# ---------------------------------------------------------------------------


class FakeSocket:
    async def send_json(self, event) -> None:  # pragma: no cover
        pass


def test_add_reports_first_socket_only():
    """First add returns True (offline→online); second returns False (already online)."""
    hub = Hub()
    a, b = FakeSocket(), FakeSocket()
    assert hub.add("u1", "d1", a) is True  # offline → online
    assert hub.add("u1", "d1", b) is False  # already online
    assert hub.is_online("u1", "d1") is True


def test_remove_reports_last_socket_only():
    """Only the remove of the last socket returns True (online→offline)."""
    hub = Hub()
    a, b = FakeSocket(), FakeSocket()
    hub.add("u1", "d1", a)
    hub.add("u1", "d1", b)
    assert hub.remove("u1", "d1", a) is False  # b still open
    assert hub.remove("u1", "d1", b) is True  # online → offline
    assert hub.is_online("u1", "d1") is False


def test_is_online_unknown_device():
    """is_online returns False for users/devices never seen."""
    hub = Hub()
    assert hub.is_online("u1", "d1") is False


def test_is_online_different_devices_independent():
    """Presence of one device does not affect another device's state."""
    hub = Hub()
    a, b = FakeSocket(), FakeSocket()
    hub.add("u1", "d1", a)
    hub.add("u1", "d2", b)
    assert hub.is_online("u1", "d1") is True
    assert hub.is_online("u1", "d2") is True
    hub.remove("u1", "d1", a)
    assert hub.is_online("u1", "d1") is False
    assert hub.is_online("u1", "d2") is True  # unaffected


def test_remove_unknown_device_returns_false():
    """Removing a socket for a device not in the registry returns False (no transition)."""
    hub = Hub()
    a = FakeSocket()
    result = hub.remove("u1", "d1", a)
    assert result is False


# ---------------------------------------------------------------------------
# Endpoint tests — presence reflected in GET /devices
# ---------------------------------------------------------------------------


def test_devices_list_reports_offline_without_ws(client):
    """Devices are offline when no WebSocket is open."""
    token, _ = register_and_login(client, device_name="my-device")
    r = client.get("/api/v1/devices", headers=auth_headers(token))
    assert r.status_code == 200
    devices = r.json()["devices"]
    assert len(devices) == 1
    assert devices[0]["online"] is False


def test_devices_list_reports_online_with_ws(client):
    """Device is online while its WebSocket is open, offline after close."""
    token, device_id = register_and_login(client, device_name="my-device")

    with client.websocket_connect(f"/api/v1/ws?token={token}"):
        r = client.get("/api/v1/devices", headers=auth_headers(token))
        assert r.status_code == 200
        devices = r.json()["devices"]
        me = next(d for d in devices if d["id"] == device_id)
        assert me["online"] is True

    # Socket closed — device must now be offline
    r = client.get("/api/v1/devices", headers=auth_headers(token))
    assert r.status_code == 200
    devices = r.json()["devices"]
    me = next(d for d in devices if d["id"] == device_id)
    assert me["online"] is False


# ---------------------------------------------------------------------------
# Broadcast tests — device_changed fires on presence transitions only
# ---------------------------------------------------------------------------


def test_ws_connect_broadcasts_device_changed_to_other_device(client):
    """When device B connects (offline→online), device A receives device_changed.

    The connecting socket is excluded from the broadcast (it caused the transition
    and does not need its own event). Only already-connected peers are notified.
    """
    token_a, _ = register_and_login(client, device_name="device-a")
    token_b, _ = register_and_login(client, device_name="device-b")

    with client.websocket_connect(f"/api/v1/ws?token={token_a}") as ws_a:
        # B connects — transition add → broadcast reaches A (B is excluded from self-notify)
        with client.websocket_connect(f"/api/v1/ws?token={token_b}"):
            event = ws_a.receive_json()
            assert event == {"type": "device_changed"}

        # B disconnects — transition remove → broadcast reaches A
        event = ws_a.receive_json()
        assert event == {"type": "device_changed"}

        # A is still alive
        ws_a.send_json({"type": "ping"})
        assert ws_a.receive_json() == {"type": "pong"}


def test_second_socket_same_device_no_broadcast(client):
    """A second socket for the same device is NOT a transition; no broadcast fires."""
    token, _ = register_and_login(client)

    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws_first:
        # Open a second connection for the same device/token — non-transition add.
        with client.websocket_connect(f"/api/v1/ws?token={token}"):
            # No broadcast expected — ping/pong arrives without device_changed.
            ws_first.send_json({"type": "ping"})
            assert ws_first.receive_json() == {"type": "pong"}


# ---------------------------------------------------------------------------
# Dead-socket prune tests (hub unit tests — fake-socket style)
# ---------------------------------------------------------------------------


import asyncio


class DeadSocket:
    """Raises on send_json — simulates a client that vanished without a close handshake."""

    async def send_json(self, event) -> None:
        raise RuntimeError("connection lost")


def test_broadcast_prunes_dead_socket_live_receives():
    """broadcast() delivers to the live socket and prunes the dead one."""
    hub = Hub()
    dead = DeadSocket()
    hub.add("u1", "d2", dead)

    # Live socket — track received events via an async send_json override.
    live = FakeSocket()
    received: list = []

    async def _live_recv(e):  # type: ignore[override]
        received.append(e)

    live.send_json = _live_recv  # type: ignore[method-assign]
    hub.add("u1", "d1", live)

    async def _run():
        await hub.broadcast("u1", {"type": "item_new"})

    asyncio.run(_run())

    # Live socket received the original event.
    assert {"type": "item_new"} in received
    # Dead socket pruned from registry.
    assert not hub.is_online("u1", "d2")
    # Live socket still registered.
    assert hub.is_online("u1", "d1")
    # Offline transition broadcast (device_changed) also reached the live device.
    assert {"type": "device_changed"} in received


def test_broadcast_dead_socket_last_triggers_offline_transition():
    """When the dead socket was the device's only socket, offline transition fires.

    The transition is signalled by remove() returning True.  The test verifies
    hub state directly (is_online goes False) rather than the broadcast side-effect,
    because the hub unit tests don't have a running app to receive device_changed.
    """
    hub = Hub()
    dead = DeadSocket()
    hub.add("u1", "d_dead", dead)
    # A second device to receive any potential broadcast.
    live = FakeSocket()
    events_on_live: list = []

    async def _live_send(e):  # type: ignore[override]
        events_on_live.append(e)

    live.send_json = _live_send  # type: ignore[method-assign]
    hub.add("u1", "d_live", live)

    async def _run():
        await hub.broadcast("u1", {"type": "item_new"})

    asyncio.run(_run())

    # Dead device removed → offline.
    assert not hub.is_online("u1", "d_dead")
    # Offline transition broadcast (device_changed) reached the live device.
    assert {"type": "device_changed"} in events_on_live


def test_broadcast_dead_socket_with_surviving_sibling_no_offline_transition():
    """If the dead socket's device has another live socket, no offline transition fires."""
    hub = Hub()
    dead = DeadSocket()
    live_sibling = FakeSocket()
    hub.add("u1", "d1", dead)
    hub.add("u1", "d1", live_sibling)  # same device — sibling survives

    observer = FakeSocket()
    observer_events: list = []

    async def _obs_send(e):  # type: ignore[override]
        observer_events.append(e)

    observer.send_json = _obs_send  # type: ignore[method-assign]
    hub.add("u1", "d2", observer)

    async def _run():
        await hub.broadcast("u1", {"type": "item_new"})

    asyncio.run(_run())

    # d1 still online (sibling alive).
    assert hub.is_online("u1", "d1")
    # No device_changed broadcast — only item_new.
    assert all(e == {"type": "item_new"} for e in observer_events)
