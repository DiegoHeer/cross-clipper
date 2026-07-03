from datetime import timedelta

from helpers import auth_headers, register_and_login
from sqlalchemy import select
from sqlalchemy.orm import Session

from crossclipper.db.models import Item, utcnow


def _post(client, token, body):
    r = client.post(
        "/api/v1/items",
        json={"kind": "text", "body": body},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    return r.json()


def test_cursor_pagination_walks_the_feed_in_id_order(client):
    token, _ = register_and_login(client)
    ids = [_post(client, token, f"item-{n}")["id"] for n in range(3)]

    r = client.get("/api/v1/items?limit=2", headers=auth_headers(token))
    page = r.json()
    assert [i["id"] for i in page["items"]] == ids[:2]
    assert page["next_cursor"] == ids[1]

    r = client.get(
        f"/api/v1/items?cursor={page['next_cursor']}", headers=auth_headers(token)
    )
    page2 = r.json()
    assert [i["id"] for i in page2["items"]] == [ids[2]]
    assert page2["next_cursor"] is None


def test_origin_filter(client):
    # register_and_login reuses the single user (registration locks after first user),
    # so token_a and token_b are two devices of ONE user — making this a true origin-filter test.
    token_a, device_a = register_and_login(client, device_name="device-a")
    token_b, device_b = register_and_login(client, device_name="device-b")
    _post(client, token_a, "from-a")
    _post(client, token_b, "from-b")

    r = client.get(f"/api/v1/items?origin={device_a}", headers=auth_headers(token_a))
    assert [i["body"] for i in r.json()["items"]] == ["from-a"]


def test_delete_produces_tombstone_visible_only_with_cursor(client):
    token, _ = register_and_login(client)
    first = _post(client, token, "keep")
    victim = _post(client, token, "secret")

    assert (
        client.delete(
            f"/api/v1/items/{victim['id']}", headers=auth_headers(token)
        ).status_code
        == 204
    )

    # cold start (no cursor): tombstone hidden
    cold = client.get("/api/v1/items", headers=auth_headers(token)).json()
    assert [i["id"] for i in cold["items"]] == [first["id"]]

    # incremental sync (with cursor): tombstone delivered, body scrubbed
    warm = client.get(
        f"/api/v1/items?cursor={first['id']}", headers=auth_headers(token)
    ).json()
    assert len(warm["items"]) == 1
    stone = warm["items"][0]
    assert stone["id"] == victim["id"]
    assert stone["deleted_at"] is not None
    assert stone["body"] == ""


def test_delete_is_idempotent_and_404s_on_unknown(client):
    token, _ = register_and_login(client)
    item = _post(client, token, "bye")
    url = f"/api/v1/items/{item['id']}"
    assert client.delete(url, headers=auth_headers(token)).status_code == 204
    assert client.delete(url, headers=auth_headers(token)).status_code == 204
    r = client.delete(
        "/api/v1/items/01JZZZZZZZZZZZZZZZZZZZZZZZ", headers=auth_headers(token)
    )
    assert r.status_code == 404


def test_prune_removes_only_expired_tombstones(client, app):
    token, _ = register_and_login(client)
    old = _post(client, token, "old")
    fresh = _post(client, token, "fresh")
    for item_id in (old["id"], fresh["id"]):
        client.delete(f"/api/v1/items/{item_id}", headers=auth_headers(token))

    from crossclipper.items.repo import ItemRepo

    with Session(app.state.engine) as session:
        session.get(Item, old["id"]).deleted_at = utcnow() - timedelta(days=40)
        session.commit()
    with Session(app.state.engine) as session:
        pruned = ItemRepo(session).prune_tombstones(utcnow() - timedelta(days=30))
        session.commit()
    assert pruned == 1
    with Session(app.state.engine) as session:
        remaining = {i.id for i in session.scalars(select(Item))}
    assert old["id"] not in remaining and fresh["id"] in remaining


def test_list_items_requires_auth(client):
    r = client.get("/api/v1/items")
    assert r.status_code == 401


def test_delete_requires_auth(client):
    token, _ = register_and_login(client)
    item = _post(client, token, "item")
    r = client.delete(f"/api/v1/items/{item['id']}")
    assert r.status_code == 401


def test_tombstone_includes_target_device_id(client):
    """Amendment: target_device_id must appear in tombstone payloads."""
    token, device_id = register_and_login(client)
    item = _post(client, token, "targeted")
    # First delete
    assert (
        client.delete(
            f"/api/v1/items/{item['id']}", headers=auth_headers(token)
        ).status_code
        == 204
    )
    # Cold fetch: gone (no cursor, tombstone hidden)
    # Warm fetch: tombstone returned with target_device_id (null here, but field present)
    # Use zero-ULID cursor (before all items) to retrieve tombstone in incremental sync
    warm = client.get(
        "/api/v1/items?cursor=00000000000000000000000000", headers=auth_headers(token)
    ).json()
    tombstone = next(i for i in warm["items"] if i["id"] == item["id"])
    assert "target_device_id" in tombstone


def test_list_page_returns_target_device_id(client):
    """Amendment: target_device_id must be included in all GET /items payloads."""
    token, _ = register_and_login(client)
    item = _post(client, token, "check-field")
    r = client.get("/api/v1/items", headers=auth_headers(token))
    assert r.status_code == 200
    result = r.json()["items"][0]
    assert "target_device_id" in result


def test_limit_boundary_validation(client):
    """limit is constrained ge=1 le=500; values outside that range → 422."""
    token, _ = register_and_login(client)
    headers = auth_headers(token)
    assert client.get("/api/v1/items?limit=0", headers=headers).status_code == 422
    assert client.get("/api/v1/items?limit=501", headers=headers).status_code == 422


def test_origin_filter_nonexistent_device(client):
    """origin= with a device id that doesn't exist → 200 with empty items list."""
    token, _ = register_and_login(client)
    r = client.get(
        "/api/v1/items?origin=NONEXISTENT-DEVICE-ID", headers=auth_headers(token)
    )
    assert r.status_code == 200
    assert r.json()["items"] == []


def test_malformed_cursor_does_not_500(client):
    """Malformed cursor (non-ULID) is compared lexicographically; accepted behavior is
    200 with an empty list (cursor sorts after all real ULIDs or matches nothing)."""
    token, _ = register_and_login(client)
    _post(client, token, "some-item")
    r = client.get("/api/v1/items?cursor=not-a-ulid!!!", headers=auth_headers(token))
    assert r.status_code == 200  # must not 500
    assert isinstance(r.json()["items"], list)
