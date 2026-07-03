"""Test that get_session rolls back on HTTPException (finding: partial write must not persist)."""

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from crossclipper.config import Settings
from crossclipper.db.models import User, utcnow
from crossclipper.db.session import get_session, init_db, make_engine


@pytest.fixture
def rollback_app(tmp_path):
    """Minimal app with one endpoint that writes then raises HTTPException."""
    settings = Settings(secret_key="test-secret", data_dir=tmp_path)
    engine = make_engine(settings.database_url)
    init_db(engine)

    app = FastAPI()
    app.state.engine = engine

    @app.post("/write-then-fail")
    def write_then_fail(session: Session = Depends(get_session)):
        session.add(
            User(
                id="u1",
                email="test@example.com",
                password_hash="x",
                created_at=utcnow(),
            )
        )
        session.flush()  # send to DB within transaction
        raise HTTPException(status_code=400, detail="intentional failure")

    return app, engine


def test_http_exception_rolls_back_partial_write(rollback_app):
    """When handler raises HTTPException after a write, the write must be rolled back."""
    app, engine = rollback_app
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/write-then-fail")

    assert r.status_code == 400

    # Verify the user was NOT persisted
    with Session(engine) as session:
        users = session.execute(select(User)).scalars().all()
    assert users == [], f"Expected no users, but found: {users}"
