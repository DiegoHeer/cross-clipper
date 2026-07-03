from sqlalchemy import inspect

from crossclipper.db.models import utcnow


def test_all_five_tables_created(app):
    names = set(inspect(app.state.engine).get_table_names())
    assert {"users", "devices", "items", "blobs", "auth_tokens"} <= names


def test_utcnow_is_naive_utc():
    now = utcnow()
    assert now.tzinfo is None
