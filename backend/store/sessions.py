"""Server-side session records keyed by hashed bearer tokens."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from store.store import NotFoundError, Store


@dataclass
class Session:
    """Session."""
    token_hash: str
    user_id: str
    expires_at: datetime
    created_at: datetime


def _parse_time(text: Any) -> datetime:
    """Internal: parse time."""
    from datetime import datetime, timezone

    if isinstance(text, datetime):
        return text if text.tzinfo is not None else text.replace(tzinfo=timezone.utc)
    if not isinstance(text, str):
        return datetime.now(timezone.utc)

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def create_session(st: Store, token_hash: str, user_id: str, expires_at: datetime, created_at: datetime) -> None:
    """Persist a new session and return the bearer token and expiry."""
    st.execute(
        """
        INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (token_hash) DO UPDATE SET
            expires_at = EXCLUDED.expires_at,
            created_at = EXCLUDED.created_at
        """,
        (
            token_hash,
            user_id,
            expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        ),
    )


def get_session_by_token_hash(st: Store, token_hash: str) -> Session:
    """Get session by token hash."""
    row = st.fetchone(
        """
        SELECT token_hash, user_id, expires_at, created_at
        FROM sessions WHERE token_hash = ?
        """,
        (token_hash,),
    )
    if row is None:
        raise NotFoundError()
    if hasattr(row, "keys"):
        return Session(
            token_hash=row["token_hash"],
            user_id=row["user_id"],
            expires_at=_parse_time(row["expires_at"]),
            created_at=_parse_time(row["created_at"]),
        )
    return Session(
        token_hash=row[0],
        user_id=row[1],
        expires_at=_parse_time(row[2]),
        created_at=_parse_time(row[3]),
    )


def delete_session(st: Store, token_hash: str) -> None:
    """Delete session."""
    st.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def delete_sessions_for_user(st: Store, user_id: str) -> None:
    """Delete sessions for user."""
    st.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
