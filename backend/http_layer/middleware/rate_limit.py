"""Rate limiting for scan admission endpoints."""

from __future__ import annotations

import time
import math
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from http_layer.errors import json_error

class ScanRateLimitMiddleware(BaseHTTPMiddleware):
    """Limite simple par IP sur les routes /api/scan*."""

    def __init__(self, app, *, max_requests: int = 120, window_seconds: float = 60.0) -> None:
        """Initialize ``ScanRateLimitMiddleware``."""
        super().__init__(app)
        self._max = max_requests
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next) -> Response:
        """Dispatch on ``ScanRateLimitMiddleware``."""
        path = request.url.path
        if not path.startswith("/api/scan"):
            return await call_next(request)
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        q = self._hits[ip]
        while q and now - q[0] > self._window:
            q.popleft()
        if len(q) >= self._max:
            return json_error(429, "rate_limited", "too many scan requests")
        q.append(now)
        return await call_next(request)

class CheckoutRateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limit public checkout and payment verify by IP."""

    RULES = {
        ("POST", "/api/payments/verify"): (10, 60),
        ("POST", "/api/orders"): (20, 60),
    }

    def __init__(self, app) -> None:
        super().__init__(app)
        self._hits: dict[tuple[str, str, str], deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next) -> Response:
        rule = self.RULES.get((request.method, request.url.path))
        if rule is None:
            return await call_next(request)

        max_requests, window_seconds = rule
        ip = request.client.host if request.client else "unknown"
        key = (ip, request.method, request.url.path)

        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= window_seconds:
            hits.popleft()

        if len(hits) >= max_requests:
            retry_after = max(1, math.ceil(window_seconds - (now - hits[0])))
            response = json_error(429, "rate_limited", "Trop de requêtes. Réessayez dans un instant.")
            response.headers["Retry-After"] = str(retry_after)
            return response

        hits.append(now)
        return await call_next(request)


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    RULES = {
        ("POST", "/api/auth/signup"): (10, 3600),
        ("POST", "/api/auth/login"): (10, 60),
        ("POST", "/api/auth/refresh"): (30, 60),
        ("POST", "/api/auth/logout"): (30, 60),
        ("GET", "/api/auth/google"): (10, 60),
        ("GET", "/api/auth/google/callback"): (30, 60),
    }

    def __init__(self, app) -> None:
        super().__init__(app)
        self._hits: dict[tuple[str, str, str], deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next) -> Response:
        rule = self.RULES.get((request.method, request.url.path))
        if rule is None:
            return await call_next(request)

        max_requests, window_seconds = rule
        ip = request.client.host if request.client else "unknown"
        key = (ip, request.method, request.url.path)

        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= window_seconds:
            hits.popleft()

        if len(hits) >= max_requests:
            retry_after = max(1, math.ceil(window_seconds - (now - hits[0])))
            response = json_error(429, "rate_limited", "too many authentication requests")
            response.headers["Retry-After"] = str(retry_after)
            return response

        hits.append(now)
        return await call_next(request)