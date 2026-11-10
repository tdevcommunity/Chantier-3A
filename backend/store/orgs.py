"""Organizations, membership, and invitation persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from store.store import NotFoundError, Store
from store.timeutil import text_to_null_time


@dataclass
class Org:
    """Org."""
    id: str
    name: str
    slug: str
    default_currency: str
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


def _row_org(row) -> Org:
    """Internal: row org."""
    if hasattr(row, "keys"):
        return Org(
            id=row["id"],
            name=row["name"],
            slug=row["slug"],
            default_currency=row["default_currency"],
            created_at=_parse_time(row["created_at"]),
        )
    return Org(
        id=row[0],
        name=row[1],
        slug=row[2],
        default_currency=row[3],
        created_at=_parse_time(row[4]),
    )


def get_org_by_slug(st: Store, slug: str) -> Org:
    """Get org by slug."""
    row = st.fetchone(
        "SELECT id, name, slug, default_currency, created_at FROM orgs WHERE slug = ?",
        (slug,),
    )
    if row is None:
        raise NotFoundError()
    return _row_org(row)


def get_org_by_id(st: Store, org_id: str) -> Org:
    """Get org by id."""
    row = st.fetchone(
        "SELECT id, name, slug, default_currency, created_at FROM orgs WHERE id = ?",
        (org_id,),
    )
    if row is None:
        raise NotFoundError()
    return _row_org(row)


def list_public_host_orgs(st: Store) -> list[Org]:
    """List public host orgs."""
    rows = st.fetchall(
        """
        SELECT o.id, o.name, o.slug, o.default_currency, o.created_at
        FROM orgs o
        WHERE EXISTS (
            SELECT 1 FROM events e WHERE e.org_id = o.id AND e.status = 'published'
        )
        ORDER BY o.name ASC, o.id ASC
        """
    )
    return [_row_org(r) for r in rows]


def count_orgs(st: Store) -> int:
    """Count orgs."""
    row = st.fetchone("SELECT COUNT(*) AS n FROM orgs")
    if row is None:
        return 0
    if hasattr(row, "keys"):
        return int(row["n"])
    return int(row[0])


class SlugTakenError(Exception):
    """Slugtakenerror."""
    pass


def slugify(name: str) -> str:
    """Slugify."""
    name = name.strip().lower()
    parts: list[str] = []
    last_hyphen = True
    for ch in name:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            parts.append(ch)
            last_hyphen = False
        elif not last_hyphen:
            parts.append("-")
            last_hyphen = True
    out = "".join(parts).rstrip("-")
    if len(out) > 60:
        out = out[:60].rstrip("-")
    return out


def create_org_with_owner(st: Store, org: Org, owner_user_id: str) -> None:
    """Create org with owner."""
    from money import currency as money
    from store.timeutil import time_to_text

    if not org.default_currency:
        org.default_currency = "USD"
    org.default_currency = money.normalize(org.default_currency)
    now_text = time_to_text(org.created_at)
    try:
        st.execute(
            """
            INSERT INTO orgs (id, name, slug, default_currency, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (org.id, org.name, org.slug, org.default_currency, now_text),
        )
        st.execute(
            """
            INSERT INTO org_members (org_id, user_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
            """,
            (org.id, owner_user_id, now_text),
        )
    except Exception as err:
        msg = str(err).lower()
        if "unique" in msg or "duplicate" in msg:
            raise SlugTakenError() from err
        raise


@dataclass
class Member:
    """Member."""
    user_id: str
    name: str
    email: str
    role: str


def list_org_members(st: Store, org_id: str) -> list[Member]:
    """List org members."""
    rows = st.fetchall(
        """
        SELECT u.id, u.name, u.email, m.role
        FROM org_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ?
        ORDER BY u.name ASC, u.id ASC
        """,
        (org_id,),
    )
    out: list[Member] = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append(Member(user_id=r["id"], name=r["name"], email=r["email"], role=r["role"]))
        else:
            out.append(Member(user_id=r[0], name=r[1], email=r[2], role=r[3]))
    return out


def get_org_member_role(st: Store, org_id: str, user_id: str) -> str:
    """Get org member role."""
    row = st.fetchone(
        "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
        (org_id, user_id),
    )
    if row is None:
        raise NotFoundError()
    return row["role"] if hasattr(row, "keys") else row[0]


@dataclass
class OrgInvite:
    """Orginvite."""
    id: str
    org_id: str
    email: str
    role: str
    token_hash: str
    expires_at: datetime
    created_at: datetime
    accepted_at: datetime | None = None


def create_org_invite(st: Store, inv: OrgInvite) -> None:
    """Create org invite."""
    from store.timeutil import time_to_text

    st.execute(
        """
        INSERT INTO org_invites (id, org_id, email, role, token_hash, invited_by, expires_at, created_at, accepted_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)
        """,
        (
            inv.id,
            inv.org_id,
            inv.email,
            inv.role,
            inv.token_hash,
            time_to_text(inv.expires_at),
            time_to_text(inv.created_at),
        ),
    )


def list_pending_org_invites(st: Store, org_id: str) -> list[OrgInvite]:
    """List pending org invites."""
    rows = st.fetchall(
        """
        SELECT id, org_id, email, role, token_hash, expires_at, created_at, accepted_at
        FROM org_invites
        WHERE org_id = ? AND accepted_at IS NULL
        ORDER BY created_at DESC, id DESC
        """,
        (org_id,),
    )
    return [_scan_invite(r) for r in rows]


def _scan_invite(row) -> OrgInvite:
    """Internal: scan invite."""
    if hasattr(row, "keys"):
        return OrgInvite(
            id=row["id"],
            org_id=row["org_id"],
            email=row["email"],
            role=row["role"],
            token_hash=row["token_hash"],
            expires_at=_parse_time(row["expires_at"]),
            created_at=_parse_time(row["created_at"]),
            accepted_at=text_to_null_time(row["accepted_at"]),
        )
    return OrgInvite(
        id=row[0],
        org_id=row[1],
        email=row[2],
        role=row[3],
        token_hash=row[4],
        expires_at=_parse_time(row[5]),
        created_at=_parse_time(row[6]),
        accepted_at=text_to_null_time(row[7]),
    )


def get_org_invite_by_token_hash(st: Store, token_hash: str) -> OrgInvite:
    """Get org invite by token hash."""
    row = st.fetchone(
        """
        SELECT id, org_id, email, role, token_hash, expires_at, created_at, accepted_at
        FROM org_invites WHERE token_hash = ?
        """,
        (token_hash,),
    )
    if row is None:
        raise NotFoundError()
    return _scan_invite(row)


def mark_invite_accepted(st: Store, invite_id: str, accepted_at: datetime) -> None:
    """Mark invite accepted."""
    from store.timeutil import time_to_text

    st.execute(
        "UPDATE org_invites SET accepted_at = ? WHERE id = ?",
        (time_to_text(accepted_at), invite_id),
    )


def add_org_member(st: Store, org_id: str, user_id: str, role: str, created_at: datetime) -> None:
    """Add org member."""
    from store.timeutil import time_to_text

    st.execute(
        """
        INSERT INTO org_members (org_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (org_id, user_id, role, time_to_text(created_at)),
    )
