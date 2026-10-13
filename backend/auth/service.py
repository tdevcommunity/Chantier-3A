"""User signup, login, sessions, and password reset orchestration."""

from __future__ import annotations

import base64
import hashlib
import secrets
import jwt
from datetime import datetime, timedelta, timezone

from auth.password import hash_password, verify_password
from store import NotFoundError, Store
from store import password_reset_tokens as reset_store
from store import sessions as session_store
from store import users as user_store
from store.users import User, save_user_refresh_token
from config import Config
from jwt.exceptions import InvalidTokenError



from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import jwt
from jwt.exceptions import InvalidTokenError
from datetime import datetime, timedelta,timezone

MIN_PASSWORD_LENGTH = 8
SESSION_TTL = timedelta(days=30)
PASSWORD_RESET_TTL = timedelta(hours=24)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


class AuthError(Exception):
    """Base class for authentication and session failures."""

    pass


class EmailTaken(AuthError):
    """Signup rejected because the email is already registered."""

    pass


class InvalidEmail(AuthError):
    """Signup or login rejected because the email format is invalid."""

    pass


class WeakPassword(AuthError):
    """Password rejected because it does not meet minimum length."""

    pass


class InvalidCredentials(AuthError):
    """Login failed due to unknown user or wrong password."""

    pass


class SessionInvalid(AuthError):
    """Session token is missing, expired, or unknown."""

    pass


class ResetTokenInvalid(AuthError):
    """Password reset token is unknown, expired, or already used."""

    pass


class NoSuchUser(AuthError):
    """Password reset requested for an email that is not registered."""

    pass


class InvalidInvite(AuthError):
    """Org invite token is invalid, expired, or already used."""

    pass


def _normalize_email(email: str) -> str:
    """Internal: normalize email (canonical form for auth and orders)."""
    from auth.email_canonical import InvalidEmail as CanonInvalid
    from auth.email_canonical import canonical_email

    try:
        return canonical_email(email)
    except CanonInvalid as exc:
        raise InvalidEmail() from exc


def _new_token() -> tuple[str, str]:
    """Internal: new token."""
    raw = secrets.token_bytes(32)
    plaintext = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    digest = hashlib.sha256(plaintext.encode("ascii")).hexdigest()
    return plaintext, digest

def signup(st: Store, email: str, password: str, name: str) -> User:
    """Register a new user; raises if email is taken or password is weak."""
    norm = _normalize_email(email)
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPassword()
    try:
        user_store.get_user_by_email(st, norm)
        raise EmailTaken()
    except NotFoundError:
        pass
    ph = hash_password(password)
    return user_store.create_user(st, user_store.UserPartial(email=norm, password_hash=ph, name=name.strip()))


def signup_with_invite(st: Store, invite_token: str, password: str, name: str) -> tuple[User, str]:
    """Register using an org invite token and join the organisation."""
    from store import orgs as orgs_repo

    token = invite_token.strip()
    if not token:
        raise InvalidInvite()
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    try:
        inv = orgs_repo.get_org_invite_by_token_hash(st, token_hash)
    except NotFoundError as err:
        raise InvalidInvite() from err
    now = datetime.now(timezone.utc)
    if inv.accepted_at is not None or inv.expires_at <= now:
        raise InvalidInvite()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPassword()
    try:
        user_store.get_user_by_email(st, inv.email)
        raise EmailTaken()
    except NotFoundError:
        pass
    ph = hash_password(password)
    display = name.strip() or inv.email.split("@")[0]
    user = user_store.create_user(st, user_store.UserPartial(email=inv.email, password_hash=ph, name=display))
    orgs_repo.add_org_member(st, inv.org_id, user.id, inv.role, now)
    orgs_repo.mark_invite_accepted(st, inv.id, now)
    return user, inv.org_id


def login(st: Store, email: str, password: str) -> User:
    """Authenticate by email and password; raises on invalid credentials."""
    norm = _normalize_email(email)
    try:
        user = user_store.get_user_by_email(st, norm)
    except NotFoundError as err:
        raise InvalidCredentials() from err
    if not verify_password(user.password_hash, password):
        raise InvalidCredentials()
    return user


def create_session(st: Store, user_id: str) -> tuple[str, datetime]:
    """Persist a new session and return the bearer token and expiry."""
    token, token_hash = _new_token()
    now = datetime.now(timezone.utc)
    expires = now + SESSION_TTL
    session_store.create_session(st, token_hash, user_id, expires, now)
    return token, expires


def validate_session(st: Store, token: str) -> User:
    """Load the user for a session token or raise ``SessionInvalid``."""
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    try:
        sess = session_store.get_session_by_token_hash(st, token_hash)
    except NotFoundError as err:
        raise SessionInvalid() from err
    if sess.expires_at <= datetime.now(timezone.utc):
        raise SessionInvalid()
    return user_store.get_user_by_id(st, sess.user_id)


def request_password_reset(st: Store, email: str) -> None:
    """Mint a reset token when the user exists (no-op if unknown email)."""
    try:
        mint_password_reset_token(st, email)
    except (NoSuchUser, InvalidEmail):
        return


def mint_password_reset_token(st: Store, email: str) -> tuple[str, datetime]:
    """Create a password reset token for the normalized email."""
    norm = _normalize_email(email)
    try:
        user = user_store.get_user_by_email(st, norm)
    except NotFoundError as err:
        raise NoSuchUser() from err
    token, token_hash = _new_token()
    now = datetime.now(timezone.utc)
    expires = now + PASSWORD_RESET_TTL
    reset_store.create_password_reset_token(
        st,
        reset_store.PasswordResetToken(
            token_hash=token_hash,
            user_id=user.id,
            expires_at=expires,
            created_at=now,
            used_at=None,
        ),
    )
    return token, expires

def reset_password(st: Store, token: str, password: str) -> None:
    """Consume a reset token and set a new password, invalidating sessions."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPassword()
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    try:
        rec = reset_store.get_password_reset_token(st, token_hash)
    except NotFoundError as err:
        raise ResetTokenInvalid() from err
    now = datetime.now(timezone.utc)
    if rec.used_at is not None or rec.expires_at <= now:
        raise ResetTokenInvalid()
    ph = hash_password(password)
    user_store.update_password_hash(st, rec.user_id, ph)
    reset_store.mark_password_reset_used(st, token_hash, now)
    session_store.delete_sessions_for_user(st, rec.user_id)


def logout(st: Store, token: str) -> None:
    """Delete the session row for the given bearer token."""
    if not token:
        return
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    session_store.delete_session(st, token_hash)


def issue_auth_tokens(
    st: Store,
    settings: Config,
    data: User,
    expire_min: int,
    auth_method: str = "password",
) -> tuple[str, str, datetime]:
    """Issue a fresh access token and a matching refresh token."""
    refresh_token = secrets.token_urlsafe(32)
    access_token, access_expire = gen_new_jwt_token(
        st,
        settings,
        data,
        expire_min,
        auth_method=auth_method,
        refresh_token=refresh_token,
    )
    return access_token, refresh_token, access_expire


""" JWT method fonctions """
def gen_new_jwt_token(st: Store, settings: Config,
                       data: User, expire_min: int,
                       auth_method: str = "password",
                       refresh_token: str | None = None,
                    ) -> tuple[str, datetime]:

    if isinstance(expire_min, str):
        expire_min = int(expire_min)

    if not settings.secret_key:
        raise RuntimeError("JWT signing key is not configured")
    if not settings.algorithm:
        raise RuntimeError("JWT algorithm is not configured")
    if expire_min <= 0:
        raise ValueError("JWT lifetime must be positive")

    issued_at = datetime.now(timezone.utc)
    access_expire = issued_at + timedelta(minutes=expire_min)

    access_claims = {
        "sub": data.id,
        "email": data.email,
        "name": data.name,
        "auth_method": auth_method,
        "iat": issued_at,
        "exp": access_expire,
    }
    access_token = jwt.encode(access_claims, settings.secret_key, algorithm=settings.algorithm)
    access_token_hash = hashlib.sha256(access_token.encode("ascii")).hexdigest()
    session_store.create_session(
        st,
        access_token_hash,
        data.id,
        access_expire,
        issued_at,
    )
    if refresh_token is not None:
        user_store.save_user_refresh_token(st, data.id, refresh_token)

    return access_token, access_expire


def validate_access_token(st: Store, settings: Config, token: str) -> User:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.algorithm],
            options={"require": ["sub", "exp"]},
        )
    except InvalidTokenError as exc:
        raise SessionInvalid() from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise SessionInvalid()

    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    try:
        session = session_store.get_session_by_token_hash(st, token_hash)
    except NotFoundError as exc:
        raise SessionInvalid() from exc
    if session.user_id != user_id or session.expires_at <= datetime.now(timezone.utc):
        raise SessionInvalid()

    try:
        user = user_store.get_user_by_id(st, user_id)
    except NotFoundError as exc:
        raise SessionInvalid() from exc
    if getattr(user, "disabled", False):
        raise SessionInvalid()
    return user


def refresh_access_token(
    st: Store,
    settings: Config,
    refresh_token: str,
    auth_method: str = "refresh",
) -> tuple[str, str, datetime]:
    """Validate a refresh token and issue a new access token + rotated refresh token."""
    if not refresh_token:
        raise SessionInvalid()
    try:
        user = user_store.get_user_by_refresh_token(st, refresh_token)
    except NotFoundError as exc:
        raise SessionInvalid() from exc
    if getattr(user, "disabled", False):
        raise SessionInvalid()

    access_token, access_expire = gen_new_jwt_token(
        st,
        settings,
        user,
        settings.access_token_expire_minutes,
        auth_method=auth_method,
    )
    new_refresh_token = secrets.token_urlsafe(32)
    user_store.save_user_refresh_token(st, user.id, new_refresh_token)
    return access_token, new_refresh_token, access_expire


def get_current_user(st: Store, settings: Config, token:str):
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except InvalidTokenError as exc:
        raise HTTPException(401, "invalid token") from exc
    email = payload.get("email")
    if email is None:
        raise HTTPException(401, "missing email claim")

    user = user_store.get_user_by_email(st, email)
    if getattr(user, "disabled", False):
        raise HTTPException(401, "user disabled")
    return user

# Verifies if a user is active (not disabled)
# Raises HTTPException if user is disabled, otherwise returns the user
def get_current_active_user(
    current_user_data: Annotated[dict, Depends(get_current_user)]
):
    user = current_user_data["user"]
    auth_method = current_user_data["auth_method"]

    if getattr(user, "disabled", False):
        raise HTTPException(status_code=400, detail="Inactive user")

    return {"user": user, "auth_method": auth_method}
