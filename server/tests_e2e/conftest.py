"""E2E test fixtures.

Session-scoped server fixture boots a real uvicorn subprocess against a
temp data directory, waits for /health == 200, and tears it down at session
end.  Tests that need to kill-and-restart the server use the function-scoped
`restart_server` fixture instead (see journey 5).
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _free_port() -> int:
    """Return an OS-assigned free TCP port."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_server(
    port: int, data_dir: Path, *, extra_env: dict | None = None
) -> subprocess.Popen:
    """Start uvicorn as a subprocess and return the Popen handle."""
    env = {
        **os.environ,
        "CC_SECRET_KEY": "e2e-test-secret-key",
        "CC_DATA_DIR": str(data_dir),
        "CC_ALLOW_REGISTRATION": "false",
        **(extra_env or {}),
    }
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "crossclipper.asgi:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc


def _wait_healthy(base_url: str, *, retries: int = 30, delay: float = 0.2) -> None:
    """Poll /health until 200 or raise RuntimeError after `retries` attempts."""
    for attempt in range(retries):
        try:
            r = httpx.get(f"{base_url}/health", timeout=2.0)
            if r.status_code == 200:
                return
        except httpx.TransportError:
            pass
        time.sleep(delay)
    raise RuntimeError(
        f"Server at {base_url} did not become healthy after {retries} attempts"
    )


def _stop_server(proc: subprocess.Popen, *, timeout: float = 5.0) -> None:
    """Gracefully stop the server, force-kill if it doesn't exit in time."""
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


# ---------------------------------------------------------------------------
# Shared server state
# ---------------------------------------------------------------------------


@dataclass
class ServerInfo:
    base_url: str
    port: int
    data_dir: Path
    proc: subprocess.Popen


# ---------------------------------------------------------------------------
# Session-scoped fixture (shared across all journeys except journey 5)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def server(
    tmp_path_factory: pytest.TempPathFactory,
) -> Generator[ServerInfo, None, None]:
    """Boot a real uvicorn server for the session; yield ServerInfo; tear down."""
    data_dir = tmp_path_factory.mktemp("e2e_data")
    port = _free_port()
    proc = _start_server(port, data_dir)
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_healthy(base_url)
        yield ServerInfo(base_url=base_url, port=port, data_dir=data_dir, proc=proc)
    finally:
        _stop_server(proc)


# ---------------------------------------------------------------------------
# Function-scoped fixture for journey 5 (kill-and-restart drill)
# ---------------------------------------------------------------------------


@pytest.fixture()
def restart_server(tmp_path: Path) -> Generator[ServerInfo, None, None]:
    """
    Dedicated server fixture for journey 5.  Provides a fresh server that the
    test can kill and restart on the same port/data-dir without affecting the
    session-scoped server used by other journeys.
    """
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    port = _free_port()
    proc = _start_server(port, data_dir)
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_healthy(base_url)
        yield ServerInfo(base_url=base_url, port=port, data_dir=data_dir, proc=proc)
    finally:
        _stop_server(proc)
