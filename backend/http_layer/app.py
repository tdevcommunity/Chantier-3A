"""Assemble the FastAPI app, middleware, API routers, and SPA fallback."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter
from starlette.middleware.sessions import SessionMiddleware

from auth import service as auth_svc
from bootstrap import AppServices, build_services
from config import Config
from http_layer.deps import AppState, _Unauthorized, unauthorized_handler
from http_layer.errors import json_error
from http_layer.middleware.rate_limit import (
    AuthRateLimitMiddleware,
    CheckoutRateLimitMiddleware,
    ScanRateLimitMiddleware,
)
from http_layer.routes import (
    auth,
    checkin as checkin_routes,
    contact,
    event_pages,
    events,
    events_admin,
    extras,
    exports,
    media,
    meta,
    oauth,
    orders,
    orgs,
    payments,
    scan,
    stubs,
    tickets,
)
from http_layer.session import check_csrf, extract_token
from spa import mount_spa
from store import Store

log = logging.getLogger("chantier3a.http")


def create_app(
    store: Store,
    config: Config,
    services: AppServices | None = None,
) -> FastAPI:
    """Create a configured FastAPI application for the given store and services."""
    app = FastAPI(title="Chantier 3A Billetterie", version="0.1.0")
    app.state.store = store
    app.state.config = config
    app.state.services = services or build_services(store, config)
    app.add_exception_handler(_Unauthorized, unauthorized_handler)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError):
        """Do not expose Pydantic loc/type details to clients."""
        log.warning("request validation failed: %s", exc.errors())
        return json_error(
            422,
            "invalid_request",
            "Requête invalide. Vérifiez les champs et réessayez.",
        )

    origins = [config.base_url.rstrip("/")] if config.base_url else ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=config.oauth_state_secret,
        same_site="lax",
        https_only=os.getenv("CHANTIER3A_PYENV") == "production",
    )

    @app.middleware("http")
    async def session_middleware(request: Request, call_next):
        """Session middleware."""
        token, via_cookie = extract_token(request)
        user = None
        if token:
            try:
                user = auth_svc.validate_access_token(app.state.store, app.state.config, token)
            except auth_svc.SessionInvalid:
                user = None
            if user and via_cookie and not check_csrf(
                request, token, via_cookie, app.state.config.session_secret
            ):
                return json_error(403, "forbidden", "CSRF token missing or invalid")
        request.state.app_state = AppState(
            store=app.state.store,
            config=app.state.config,
            services=app.state.services,
            current_user=user,
            session_token=token,
            auth_via_cookie=via_cookie,
        )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

    app.include_router(meta.root_router)
    app.include_router(media.router)

    api = APIRouter(prefix="/api")
    api.include_router(meta.api_router)
    api.include_router(contact.router)
    api.include_router(auth.router)
    api.include_router(oauth.router)
    api.include_router(events.router)
    api.include_router(events_admin.router)
    api.include_router(events_admin.ticket_router)
    api.include_router(orgs.router)
    api.include_router(orgs.invites_router)
    api.include_router(event_pages.router)
    api.include_router(orders.router)
    api.include_router(payments.router)
    api.include_router(tickets.router)
    api.include_router(scan.router)
    api.include_router(checkin_routes.router)
    api.include_router(exports.router)
    api.include_router(extras.router)
    api.include_router(extras.images_router)
    app.add_middleware(ScanRateLimitMiddleware)
    app.add_middleware(CheckoutRateLimitMiddleware)
    app.add_middleware(AuthRateLimitMiddleware)
    stubs.register_stubs(api)
    app.include_router(api)

    mount_spa(app)

    @app.on_event("startup")
    def _start_background_jobs() -> None:
        from orders.pending_cleanup import start_pending_cleanup_loop

        start_pending_cleanup_loop(store)

    return app
