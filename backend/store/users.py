"""Persist and load user account rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from store.store import NotFoundError, Store, new_ulid

class Provider(str, Enum):
    """ 0Auth provider """
    Google = "google"
    Github = "github"

@dataclass
class User:
    """User"""

    id: str
    created_at: datetime
    login_at: datetime
    email: str | None = None
    password_hash: str | None = None
    name: str | None = None
    full_name: str | None = None
    avatar: str | None = None
    provider: Provider | None = None
    provider_user_id: str | None = None
    refresh_token: str | None = None
    email_verified_at: datetime | None = None
    disabled: bool = False

class UserPartial():
    def __init__(
        self,
        email: str | None = None,
        password_hash: str | None = None,
        name: str | None = None,
        full_name: str | None = None,
        avatar: str | None = None,
        provider: Provider | None = None,
        provider_user_id: str | None = None,
        refresh_token: str | None = None,
        disabled: bool = False
    ):
        self.email = email
        self.password_hash = password_hash
        self.name = name
        self.full_name = full_name
        self.avatar = avatar
        self.provider = provider
        self.provider_user_id = provider_user_id
        self.refresh_token = refresh_token
        self.disabled = disabled

    email: str | None = None
    password_hash: str | None = None
    name: str | None = None
    full_name: str | None = None
    avatar: str | None = None
    provider: Provider | None = None
    provider_user_id: str | None = None
    refresh_token: str | None = None
    disabled: bool = False

def _parse_time(text: Any) -> datetime | None:
    """Internal: parse time."""
    if not text:
        return None
    if isinstance(text, datetime):
        return text if text.tzinfo is not None else text.replace(tzinfo=timezone.utc)
    if not isinstance(text, str):
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).astimezone(timezone.utc)
    except Exception:
        return None


def get_user_by_email(st: Store, email: str) -> User:
    """Get user by email."""
    row = st.fetchone(
        """
         SELECT id, email, password_hash, name, full_name, avatar, provider, provider_user_id,
             created_at, login_at, email_verified_at, disabled
        FROM users WHERE email = ?
        """,
        (email,),
    )
    if row is None:
        raise NotFoundError()
    return _row_user(row)


def get_user_by_id(st: Store, user_id: str) -> User:
    """Get user by id."""
    row = st.fetchone(
        """
         SELECT id, email, password_hash, name, full_name, avatar, provider, provider_user_id,
             created_at, login_at, email_verified_at, disabled
        FROM users WHERE id = ?
        """,
        (user_id,),
    )
    if row is None:
        raise NotFoundError()
    return _row_user(row)


def get_user_by_avatar(st: Store, user_avatar: str) -> User:
    """Get user by avatar"""
    row = st.fetchone(
        """
         SELECT id, email, password_hash, name, full_name, avatar, provider, provider_user_id,
             created_at, login_at, email_verified_at, disabled
        FROM users WHERE avatar = ?
        """,
        (user_avatar,),
    )
    if row is None:
        raise NotFoundError()
    return _row_user(row)

def get_user_by_provider_user_id(
    st: Store,
    provider: Provider,
    provider_user_id: str,
) -> User:
    """Get user by provider and provider_user_id."""
    row = st.fetchone(
        """
         SELECT id, email, password_hash, name, full_name, avatar, provider, provider_user_id,
             created_at, login_at, email_verified_at, disabled
        FROM users WHERE provider = ? AND provider_user_id = ?
        """,
        (provider.value, provider_user_id),
    )
    if row is None:
        raise NotFoundError()
    return _row_user(row)


def get_user_by_refresh_token(st: Store, token: str) -> User:
    """Get user by refresh token."""
    row = st.fetchone(
        """
         SELECT id, email, password_hash, name, full_name, avatar, provider, provider_user_id,
             created_at, login_at, email_verified_at, disabled
        FROM users WHERE refresh_token = ?
        """,
        (token,),
    )
    if row is None:
        raise NotFoundError()
    return _row_user(row)


def create_user(st: Store, user: UserPartial) -> User:
    """Create user"""
    uid = new_ulid()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    now_text = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if user.password_hash:
        st.execute(
            """
            INSERT INTO users (id, email, password_hash, name, created_at, login_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (uid, user.email, user.password_hash, user.name or "", now_text, now_text),
        )
        return User(
            id=uid,
            email=user.email,
            password_hash=user.password_hash,
            name=user.name or "",
            created_at=now,
            login_at=now,
        )

    st.execute(
        """
        INSERT INTO users (
            id, email, password_hash, name, full_name, avatar, provider, provider_user_id,
            created_at, login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            uid,
            user.email,
            "",
            user.name or "",
            user.full_name or "",
            user.avatar,
            user.provider.value if isinstance(user.provider, Provider) else user.provider,
            user.provider_user_id,
            now_text,
            now_text,
        )
    )
    return User(
        id=uid,
        email=user.email,
        password_hash=None,
        name=user.name or "",
        full_name=user.full_name or "",
        avatar=user.avatar,
        provider=user.provider,
        provider_user_id=user.provider_user_id,
        created_at=now,
        login_at=now,
    )


def update_password_hash(st: Store, user_id: str, password_hash: str) -> None:
    """Update password hash."""
    n = st.execute_rowcount(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (password_hash, user_id),
    )
    if n == 0:
        raise NotFoundError()


def save_user_refresh_token(st: Store, user_id: str, token: str) -> User:
    """Set refresh token"""
    n = st.execute_rowcount(
        "UPDATE users SET refresh_token = ? WHERE id = ?",
        (token, user_id),
    )
    if n == 0:
        raise NotFoundError()


def clear_user_refresh_token(st: Store, user_id: str) -> None:
    """Clear refresh token for user."""
    n = st.execute_rowcount(
        "UPDATE users SET refresh_token = NULL WHERE id = ?",
        (user_id,),
    )
    if n == 0:
        raise NotFoundError()


def _row_user(row) -> User:
    """Internal: row user."""
    if hasattr(row, "keys"):
        get = lambda k: row[k]
        ev = get("email_verified_at")
        disabled = bool(get("disabled") or False)
        return User(
            id=get("id"),
            email=get("email"),
            password_hash=get("password_hash"),
            name=get("name"),
            full_name=get("full_name"),
            avatar=get("avatar"),
            provider=Provider(get("provider")) if get("provider") else None,
            provider_user_id=get("provider_user_id"),
            created_at=_parse_time(get("created_at")),
            login_at=_parse_time(get("login_at")) or _parse_time(get("created_at")),
            email_verified_at=_parse_time(ev) if ev else None,
            disabled=disabled,
        )

    # tuple path
    if len(row) >= 12:
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            name=row[3],
            full_name=row[4],
            avatar=row[5],
            provider=Provider(row[6]) if row[6] else None,
            provider_user_id=row[7],
            created_at=_parse_time(row[8]),
            login_at=_parse_time(row[9]) or _parse_time(row[8]),
            email_verified_at=_parse_time(row[10]) if row[10] else None,
            disabled=bool(row[11]),
        )
    if len(row) >= 11:
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            name=row[3],
            full_name=row[4],
            avatar=row[5],
            provider=Provider(row[6]) if row[6] else None,
            provider_user_id=row[7],
            created_at=_parse_time(row[8]),
            login_at=_parse_time(row[9]) or _parse_time(row[8]),
            email_verified_at=_parse_time(row[10]) if row[10] else None,
            disabled=False,
        )

    raise ValueError("Unexpected user row shape")