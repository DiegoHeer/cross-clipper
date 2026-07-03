"""Tests for the prune-loop isolation (_safe_prune survives exceptions)."""

import logging

from crossclipper.main import _safe_prune


def test_safe_prune_calls_prune_fn(caplog):
    called = []

    def prune_fn():
        called.append(True)

    with caplog.at_level(logging.ERROR, logger="crossclipper.main"):
        _safe_prune(prune_fn)

    assert called == [True]
    # No error logged when prune succeeds
    assert not caplog.records


def test_safe_prune_logs_on_exception_and_does_not_reraise(caplog):
    def exploding_prune():
        raise RuntimeError("db blew up")

    with caplog.at_level(logging.ERROR, logger="crossclipper.main"):
        # Must not raise — loop must survive
        _safe_prune(exploding_prune)

    # Exception must have been logged
    assert any(
        "db blew up" in r.message or "db blew up" in str(r.exc_info)
        for r in caplog.records
    )
