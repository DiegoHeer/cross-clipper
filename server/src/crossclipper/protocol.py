def _parse(version: str) -> tuple[int, ...] | None:
    try:
        return tuple(int(p) for p in version.strip().split("."))
    except ValueError:
        return None


def version_ok(client: str, minimum: str) -> bool:
    """Lenient gate: unparseable versions pass; only a clearly-older client is refused."""
    c, m = _parse(client), _parse(minimum)
    if c is None or m is None:
        return True
    return c >= m
