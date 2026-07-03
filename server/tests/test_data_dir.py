"""Boot-time /data writability check (system spec §7: fail fast, no chown magic)."""

import os
from pathlib import Path

import pytest

from crossclipper.config import Settings
from crossclipper.main import create_app


@pytest.mark.skipif(os.getuid() == 0, reason="root bypasses permission checks")
def test_unwritable_data_dir_exits_with_chown_hint(tmp_path: Path) -> None:
    locked = tmp_path / "data"
    locked.mkdir()
    locked.chmod(0o500)  # r-x: cannot create files inside
    try:
        with pytest.raises(SystemExit) as excinfo:
            create_app(Settings(secret_key="t", data_dir=locked))
        msg = str(excinfo.value)
        assert "is not writable by UID" in msg
        assert "chown -R 1000:1000 ./data" in msg
        assert "user:" in msg  # compose hint
    finally:
        locked.chmod(0o700)  # let pytest clean up tmp_path


@pytest.mark.skipif(os.getuid() == 0, reason="root bypasses permission checks")
def test_uncreatable_data_dir_exits_with_chown_hint(tmp_path: Path) -> None:
    parent = tmp_path / "parent"
    parent.mkdir()
    parent.chmod(0o500)
    try:
        with pytest.raises(SystemExit, match="is not writable by UID"):
            create_app(Settings(secret_key="t", data_dir=parent / "data"))
    finally:
        parent.chmod(0o700)


def test_writable_data_dir_boots_normally(tmp_path: Path) -> None:
    app = create_app(Settings(secret_key="t", data_dir=tmp_path / "data"))
    assert app.state.settings.data_dir.exists()
