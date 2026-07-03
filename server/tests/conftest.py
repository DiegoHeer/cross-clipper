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
    with TestClient(app) as c:
        yield c
