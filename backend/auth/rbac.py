"""Organization and event role checks for organizers and scanners."""

from __future__ import annotations

from store.store import NotFoundError, Store

ROLE_OWNER = "owner"
ROLE_ADMIN = "admin"
ROLE_SCANNER = "scanner"

_RANK = {ROLE_SCANNER: 1, ROLE_ADMIN: 2, ROLE_OWNER: 3}


def role_meets(actual: str, minimum: str) -> bool:
    """Return whether ``actual`` org role rank meets ``minimum``."""
    a = _RANK.get(actual)
    m = _RANK.get(minimum)
    if a is None or m is None:
        return False
    return a >= m


def event_org_id(st: Store, event_id: str) -> str:
    """Resolve the owning organization id for an event id."""
    row = st.fetchone("SELECT org_id FROM events WHERE id = ?", (event_id,))
    if row is None:
        raise NotFoundError()
    return row["org_id"] if hasattr(row, "keys") else row[0]


def can_manage_org(st: Store, user_id: str, org_id: str, min_role: str) -> bool:
    """Check if the user has at least ``min_role`` in the organization."""
    row = st.fetchone(
        "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
        (org_id, user_id),
    )
    if row is None:
        return False
    role = row["role"] if hasattr(row, "keys") else row[0]
    return role_meets(role, min_role)


def can_manage_event_as_owner(st: Store, user_id: str, event_id: str) -> bool:
    """Organizer actions reserved to the org owner (exports, catalog config, orders list)."""
    return can_manage_event(st, user_id, event_id, ROLE_OWNER)


def can_manage_event(st: Store, user_id: str, event_id: str, min_role: str) -> bool:
    """Check if the user can manage the event via its owning org membership."""
    try:
        org_id = event_org_id(st, event_id)
    except NotFoundError:
        return False
    row = st.fetchone(
        "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
        (org_id, user_id),
    )
    if row is None:
        return False
    role = row["role"] if hasattr(row, "keys") else row[0]
    return role_meets(role, min_role)
