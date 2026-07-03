import time
from collections import defaultdict, deque
from collections.abc import Callable


class RateLimiter:
    """In-memory sliding window. Per-process is fine: one server process (§2)."""

    def __init__(
        self,
        max_events: int,
        window_seconds: float,
        now: Callable[[], float] = time.monotonic,
    ):
        self.max_events = max_events
        self.window = window_seconds
        self._now = now
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        t = self._now()
        q = self._events[key]
        while q and q[0] <= t - self.window:
            q.popleft()
        if len(q) >= self.max_events:
            return False
        q.append(t)
        return True
