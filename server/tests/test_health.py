from fastapi.testclient import TestClient

from crossclipper.config import Settings
from crossclipper.main import create_app


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_reports_unwritable_blob_dir(tmp_path):
    app = create_app(Settings(secret_key="t", data_dir=tmp_path))
    (tmp_path / "blobs").chmod(0o500)
    try:
        with TestClient(app) as c:
            r = c.get("/health")
        assert r.status_code == 503
        assert r.json()["code"] == "unhealthy"
    finally:
        (tmp_path / "blobs").chmod(0o700)
