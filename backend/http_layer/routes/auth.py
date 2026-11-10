"""Signup, login, logout, and password reset HTTP handlers."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from auth import service as auth_svc
from http_layer.deps import AppState, get_app_state
from http_layer.errors import json_error
from http_layer.session import clear_jwt_cookies, set_jwt_cookies, set_refresh_cookie
from store.users import User

router = APIRouter(prefix="/auth", tags=["auth"])


class CredentialsBody(BaseModel):
    """Email, password, and optional display name for signup."""
    email: str = ""
    password: str = ""
    name: str = Field(default="", alias="name")

    model_config = {"populate_by_name": True}


class SignupWithInviteBody(BaseModel):
    """Create a staff account from an org invite token."""
    token: str = ""
    password: str = ""
    name: str = ""


def _user_view(u: User) -> dict:
    """Internal: user view."""
    created_at = u.created_at
    if isinstance(created_at, datetime):
        created_str = created_at.isoformat().replace("+00:00", "Z")
    elif created_at:
        created_str = str(created_at)
    else:
        created_str = ""
    out = {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "created_at": created_str,
    }
    if u.email_verified_at:
        ev = u.email_verified_at
        if isinstance(ev, datetime):
            out["email_verified_at"] = ev.isoformat().replace("+00:00", "Z")
        else:
            out["email_verified_at"] = str(ev)
    return out


def _secure_request(request: Request) -> bool:
    """Internal: secure request."""
    if request.url.scheme == "https":
        return True
    return request.headers.get("X-Forwarded-Proto", "").lower() == "https"


@router.post("/signup")
def signup(
    request: Request,
    body: CredentialsBody,
    state: AppState = Depends(get_app_state),
) -> Response:
    """Register a new user; disabled when public signup is off (staff uses invite flow)."""
    if not state.config.public_signup:
        return json_error(
            403,
            "forbidden",
            "public signup is disabled; use an administrator invite to create an account",
        )
    try:
        user = auth_svc.signup(state.store, body.email, body.password, body.name)
    except auth_svc.InvalidEmail:
        return json_error(400, "invalid_request", "invalid email address")
    except auth_svc.WeakPassword:
        return json_error(400, "invalid_request", "password too short")
    except auth_svc.EmailTaken:
        return json_error(409, "conflict", "an account with that email already exists")
    except Exception:
        return json_error(500, "internal_error", "internal error")

    access_token, refresh_token, expires = auth_svc.issue_auth_tokens(
        state.store,
        state.config,
        user,
        state.config.access_token_expire_minutes,
        auth_method="password_hash",
    )
    payload = {
        "user": _user_view(user),
        "token": access_token,
        "refresh_token": refresh_token,
    }
    resp = Response(content=json.dumps(payload), media_type="application/json")
    set_jwt_cookies(resp, access_token, expires, state.config.session_secret, _secure_request(request))
    set_refresh_cookie(resp, refresh_token, datetime.now(timezone.utc) + auth_svc.SESSION_TTL, _secure_request(request))
    return resp


@router.post("/signup-with-invite")
def signup_with_invite(
    request: Request,
    body: SignupWithInviteBody,
    state: AppState = Depends(get_app_state),
) -> Response:
    """Create a staff account from an org invite (replaces public signup)."""
    if not body.token or not body.password:
        return json_error(400, "invalid_request", "token and password are required")
    try:
        user, _org_id = auth_svc.signup_with_invite(
            state.store, body.token, body.password, body.name
        )
    except auth_svc.InvalidInvite:
        return json_error(400, "invalid_request", "invite is invalid, expired, or already used")
    except auth_svc.WeakPassword:
        return json_error(400, "invalid_request", "password too short")
    except auth_svc.EmailTaken:
        return json_error(409, "conflict", "an account with that email already exists; log in and accept the invite")
    except Exception:
        return json_error(500, "internal_error", "internal error")

    access_token, refresh_token, expires = auth_svc.issue_auth_tokens(
        state.store,
        state.config,
        user,
        state.config.access_token_expire_minutes,
        auth_method="password_hash",
    )
    payload = {
        "user": _user_view(user),
        "token": access_token,
        "refresh_token": refresh_token,
    }
    resp = Response(content=json.dumps(payload), media_type="application/json")
    set_jwt_cookies(resp, access_token, expires, state.config.session_secret, _secure_request(request))
    set_refresh_cookie(resp, refresh_token, datetime.now(timezone.utc) + auth_svc.SESSION_TTL, _secure_request(request))
    return resp


@router.post("/login")
def login(
    request: Request,
    body: CredentialsBody,
    state: AppState = Depends(get_app_state),
) -> Response:
    """Authenticate by email and password; raises on invalid credentials."""
    try:
        user = auth_svc.login(state.store, body.email, body.password)
    except auth_svc.InvalidCredentials:
        return json_error(401, "unauthorized", "invalid email or password")
    except auth_svc.InvalidEmail:
        return json_error(400, "invalid_request", "invalid email address")
    except Exception:
        return json_error(500, "internal_error", "internal error")

    access_token, refresh_token, expires = auth_svc.issue_auth_tokens(
        state.store,
        state.config,
        user,
        state.config.access_token_expire_minutes,
        auth_method="password_hash",
    )
    payload = {
        "user": _user_view(user),
        "token": access_token,
        "refresh_token": refresh_token,
    }
    resp = Response(content=json.dumps(payload), media_type="application/json")
    set_jwt_cookies(resp, access_token, expires, state.config.session_secret, _secure_request(request))
    set_refresh_cookie(resp, refresh_token, datetime.now(timezone.utc) + auth_svc.SESSION_TTL, _secure_request(request))
    return resp


@router.post("/refresh")
def refresh(
    request: Request,
    state: AppState = Depends(get_app_state),
) -> Response:
    """Swap a valid refresh token for a new access token pair."""
    refresh_token = request.headers.get("Authorization", "")
    if refresh_token.startswith("Bearer "):
        refresh_token = refresh_token[7:].strip()
    else:
        refresh_token = request.cookies.get("chantier3a_refresh", "")
    if not refresh_token:
        return json_error(401, "unauthorized", "refresh token required")
    try:
        access_token, new_refresh_token, expires = auth_svc.refresh_access_token(
            state.store,
            state.config,
            refresh_token,
        )
    except auth_svc.SessionInvalid:
        return json_error(401, "unauthorized", "refresh token invalid or expired")
    payload = {"token": access_token, "refresh_token": new_refresh_token}
    resp = Response(content=json.dumps(payload), media_type="application/json")
    set_jwt_cookies(resp, access_token, expires, state.config.session_secret, _secure_request(request))
    set_refresh_cookie(resp, new_refresh_token, datetime.now(timezone.utc) + auth_svc.SESSION_TTL, _secure_request(request))
    return resp


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    state: AppState = Depends(get_app_state),
) -> Response:
    """Delete the session row for the given bearer token."""
    if state.current_user is not None:
        auth_svc.user_store.clear_user_refresh_token(state.store, state.current_user.id)
    if state.session_token:
        auth_svc.logout(state.store, state.session_token)
    resp = Response(status_code=204)
    clear_jwt_cookies(resp, _secure_request(request))
    return resp


@router.get("/me")
def me(state: AppState = Depends(get_app_state)) -> Response:
    """Me."""
    if state.current_user is None:
        return json_error(401, "unauthorized", "authentication required")
    return Response(
        content=json.dumps({"user": _user_view(state.current_user)}),
        media_type="application/json",
    )


@router.get("/providers")
def providers() -> dict:
    """Providers."""
    return {"providers": []}


class PasswordResetBody(BaseModel):
    """Email address for initiating a password reset."""
    email: str = ""


class PasswordUpdateBody(BaseModel):
    """Reset token and new password for completing password reset."""
    token: str = ""
    password: str = ""


@router.post("/password-reset")
def password_reset(body: PasswordResetBody, state: AppState = Depends(get_app_state)) -> dict:
    """Password reset."""
    try:
        auth_svc.request_password_reset(state.store, body.email)
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"ok": True}


@router.post("/password-update")
def password_update(body: PasswordUpdateBody, state: AppState = Depends(get_app_state)) -> dict:
    """Password update."""
    if not body.token or not body.password:
        return json_error(400, "invalid_request", "token and password are required")
    try:
        auth_svc.reset_password(state.store, body.token, body.password)
    except auth_svc.ResetTokenInvalid:
        return json_error(400, "invalid_request", "reset token invalid, expired, or already used")
    except auth_svc.WeakPassword:
        return json_error(400, "invalid_request", "password too short")
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"ok": True}


class ChangePasswordBody(BaseModel):
    old_password: str = ""
    new_password: str = ""
    current_password: str = ""


@router.post("/change-password")
def change_password(body: ChangePasswordBody, state: AppState = Depends(get_app_state)) -> dict:
    """Change password for the currently authenticated user."""
    if state.current_user is None:
        return json_error(401, "unauthorized", "Connexion requise.")
    old_pw = (body.old_password or body.current_password).strip()
    new_pw = body.new_password.strip()
    if not old_pw or not new_pw:
        return json_error(400, "invalid_request", "L'ancien et le nouveau mot de passe sont requis.")
    if len(new_pw) < auth_svc.MIN_PASSWORD_LENGTH:
        return json_error(
            400,
            "invalid_request",
            f"Le mot de passe doit comporter au moins {auth_svc.MIN_PASSWORD_LENGTH} caractères.",
        )
    user = state.current_user
    if not user.password_hash or not auth_svc.verify_password(user.password_hash, old_pw):
        return json_error(401, "unauthorized", "Ancien mot de passe incorrect.")

    from auth.password import hash_password
    from store import users as user_store
    new_hash = hash_password(new_pw)
    user_store.update_password_hash(state.store, user.id, new_hash)
    return {"ok": True, "message": "Mot de passe mis à jour avec succès."}
