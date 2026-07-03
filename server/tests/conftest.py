import pytest
from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(secret_key="test-secret", data_dir=tmp_path)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    # `app` depends on `settings(tmp_path)`, which is function-scoped (pytest default).
    # Each test therefore receives a brand-new app instance — and a brand-new
    # `app.state.limiter` — so rate-limit counts never leak between tests.
    with TestClient(app) as c:
        yield c
