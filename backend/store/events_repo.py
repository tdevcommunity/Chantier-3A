"""Event CRUD, publishing workflow, and listing queries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from store.store import Store


@dataclass
class EventRow:
    """Eventrow."""
    id: str
    org_id: str
    slug: str
    title: str
    summary: str
    description: str
    venue_name: str
    address: str
    lat: float | None
    lng: float | None
    starts_at: datetime
    ends_at: datetime
    timezone: str
    cover_image: str
    status: str
    currency: str
    category: str
    cover_image_id: str | None
    created_at: datetime
    updated_at: datetime


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


def _null_float(v: Any) -> float | None:
    """Internal: null float."""
    if v is None:
        return None
    return float(v)


def _row_event(row) -> EventRow:
    """Internal: row event."""
    if hasattr(row, "keys"):
        g = row.__getitem__
        return EventRow(
            id=g("id"),
            org_id=g("org_id"),
            slug=g("slug"),
            title=g("title"),
            summary=g("summary") or "",
            description=g("description") or "",
            venue_name=g("venue_name") or "",
            address=g("address") or "",
            lat=_null_float(g("lat")),
            lng=_null_float(g("lng")),
            starts_at=_parse_time(g("starts_at")),
            ends_at=_parse_time(g("ends_at")),
            timezone=g("timezone") or "",
            cover_image=g("cover_image") or "",
            status=g("status"),
            currency=g("currency"),
            category=g("category") or "",
            cover_image_id=g("cover_image_id"),
            created_at=_parse_time(g("created_at")),
            updated_at=_parse_time(g("updated_at")),
        )
    # tuple from sqlite
    return EventRow(
        id=row[0],
        org_id=row[1],
        slug=row[2],
        title=row[3],
        summary=row[4] or "",
        description=row[5] or "",
        venue_name=row[6] or "",
        address=row[7] or "",
        lat=_null_float(row[8]),
        lng=_null_float(row[9]),
        starts_at=_parse_time(row[10]),
        ends_at=_parse_time(row[11]),
        timezone=row[12] or "",
        cover_image=row[13] or "",
        status=row[14],
        currency=row[15],
        category=row[16] or "",
        cover_image_id=row[17],
        created_at=_parse_time(row[18]),
        updated_at=_parse_time(row[19]),
    )


def like_escape(s: str) -> str:
    """Like escape."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_published_events(
    st: Store,
    query: str,
    category: str,
    org_ids: list[str] | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    limit: int,
) -> list[EventRow]:
    """List published events."""
    if limit <= 0:
        limit = 50
    if limit > 200:
        limit = 200

    sql = """
        SELECT id, org_id, slug, title, summary, description, venue_name, address,
               lat, lng, starts_at, ends_at, timezone, cover_image, status, currency,
               category, cover_image_id, created_at, updated_at
        FROM events WHERE status = 'published'
    """
    args: list[Any] = []

    if org_ids is not None:
        if len(org_ids) == 0:
            sql += " AND 0 = 1"
        else:
            placeholders = ", ".join("?" for _ in org_ids)
            sql += f" AND org_id IN ({placeholders})"
            args.extend(org_ids)

    if query:
        sql += " AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR venue_name LIKE ? ESCAPE '\\')"
        like = f"%{like_escape(query)}%"
        args.extend([like, like, like])

    if category:
        sql += " AND category = ?"
        args.append(category)

    if from_ts is not None:
        sql += " AND starts_at >= ?"
        args.append(from_ts.strftime("%Y-%m-%dT%H:%M:%SZ"))

    if to_ts is not None:
        sql += " AND starts_at <= ?"
        args.append(to_ts.strftime("%Y-%m-%dT%H:%M:%SZ"))

    sql += " ORDER BY starts_at ASC, id ASC LIMIT ?"
    args.append(limit)

    rows = st.fetchall(sql, tuple(args))
    return [_row_event(r) for r in rows]


def get_event_by_id(st: Store, event_id: str) -> EventRow:
    """Get event by id."""
    row = st.fetchone(
        """
        SELECT id, org_id, slug, title, summary, description, venue_name, address,
               lat, lng, starts_at, ends_at, timezone, cover_image, status, currency,
               category, cover_image_id, created_at, updated_at
        FROM events WHERE id = ?
        """,
        (event_id,),
    )
    if row is None:
        from store.store import NotFoundError

        raise NotFoundError()
    return _row_event(row)


def get_event_by_slug(st: Store, slug: str) -> EventRow:
    """Get event by slug."""
    row = st.fetchone(
        """
        SELECT id, org_id, slug, title, summary, description, venue_name, address,
               lat, lng, starts_at, ends_at, timezone, cover_image, status, currency,
               category, cover_image_id, created_at, updated_at
        FROM events WHERE slug = ?
        """,
        (slug,),
    )
    if row is None:
        from store.store import NotFoundError

        raise NotFoundError()
    return _row_event(row)


def list_events_by_org(st: Store, org_id: str) -> list[EventRow]:
    """List events by org."""
    rows = st.fetchall(
        """
        SELECT id, org_id, slug, title, summary, description, venue_name, address,
               lat, lng, starts_at, ends_at, timezone, cover_image, status, currency,
               category, cover_image_id, created_at, updated_at
        FROM events WHERE org_id = ? ORDER BY created_at DESC, id DESC
        """,
        (org_id,),
    )
    return [_row_event(r) for r in rows]


def update_event(st: Store, e: EventRow) -> None:
    """Update event."""
    from store.timeutil import time_to_text

    n = st.execute_rowcount(
        """
        UPDATE events SET
            slug = ?, title = ?, summary = ?, description = ?, venue_name = ?, address = ?,
            lat = ?, lng = ?, starts_at = ?, ends_at = ?, timezone = ?, cover_image = ?,
            status = ?, currency = ?, category = ?, cover_image_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            e.slug,
            e.title,
            e.summary,
            e.description,
            e.venue_name,
            e.address,
            e.lat,
            e.lng,
            time_to_text(e.starts_at),
            time_to_text(e.ends_at),
            e.timezone,
            e.cover_image,
            e.status,
            e.currency,
            e.category,
            e.cover_image_id,
            time_to_text(e.updated_at),
            e.id,
        ),
    )
    if n == 0:
        from store.store import NotFoundError

        raise NotFoundError()


def set_event_status(st: Store, event_id: str, status: str, updated_at: datetime) -> None:
    """Set event status."""
    from store.timeutil import time_to_text

    n = st.execute_rowcount(
        "UPDATE events SET status = ?, updated_at = ? WHERE id = ?",
        (status, time_to_text(updated_at), event_id),
    )
    if n == 0:
        from store.store import NotFoundError

        raise NotFoundError()


def delete_event(st: Store, event_id: str) -> None:
    """Delete event."""
    n = st.execute_rowcount("DELETE FROM events WHERE id = ?", (event_id,))
    if n == 0:
        from store.store import NotFoundError

        raise NotFoundError()


def count_tickets_for_event(st: Store, event_id: str) -> int:
    """Count tickets for event."""
    row = st.fetchone("SELECT COUNT(*) AS n FROM tickets WHERE event_id = ?", (event_id,))
    if row is None:
        return 0
    return int(row["n"] if hasattr(row, "keys") else row[0])


@dataclass
class CategoryCount:
    """Categorycount."""
    slug: str
    count: int


def list_category_counts(st: Store) -> list[CategoryCount]:
    """List category counts."""
    rows = st.fetchall(
        """
        SELECT category, COUNT(*) AS n
        FROM events
        WHERE status = 'published' AND category != ''
        GROUP BY category
        ORDER BY n DESC, category ASC
        """
    )
    out: list[CategoryCount] = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append(CategoryCount(slug=r["category"], count=int(r["n"])))
        else:
            out.append(CategoryCount(slug=r[0], count=int(r[1])))
    return out


@dataclass
class TicketTypeStatsRow:
    """Tickettypestatsrow."""
    ticket_type_id: str
    name: str
    quantity_total: int
    sold: int
    revenue_minor: int


def ticket_type_stats_for_event(st: Store, event_id: str) -> list[TicketTypeStatsRow]:
    """Ticket type stats for event."""
    rows = st.fetchall(
        """
        SELECT tt.id, tt.name, tt.quantity_total,
               COALESCE(SUM(CASE WHEN o.status = 'paid' THEN oi.quantity ELSE 0 END), 0) AS sold,
               COALESCE(SUM(CASE WHEN o.status = 'paid' THEN oi.quantity * oi.unit_price_minor ELSE 0 END), 0) AS revenue
        FROM ticket_types tt
        LEFT JOIN order_items oi ON oi.ticket_type_id = tt.id
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE tt.event_id = ?
        GROUP BY tt.id, tt.name, tt.quantity_total
        ORDER BY tt.sort_order ASC, tt.id ASC
        """,
        (event_id,),
    )
    out: list[TicketTypeStatsRow] = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append(
                TicketTypeStatsRow(
                    ticket_type_id=r["id"],
                    name=r["name"],
                    quantity_total=int(r["quantity_total"]),
                    sold=int(r["sold"]),
                    revenue_minor=int(r["revenue"]),
                )
            )
        else:
            out.append(
                TicketTypeStatsRow(
                    ticket_type_id=r[0],
                    name=r[1],
                    quantity_total=int(r[2]),
                    sold=int(r[3]),
                    revenue_minor=int(r[4]),
                )
            )
    return out


def count_admitted_for_event(st: Store, event_id: str) -> int:
    """Count authoritative main-entrance admissions for an event."""
    row = st.fetchone(
        """SELECT COUNT(*) AS n FROM admissions
           WHERE event_id = ? AND result = 'admitted'
             AND control_type = 'event_entry'""",
        (event_id,),
    )
    if row is None:
        return 0
    return int(row["n"] if hasattr(row, "keys") else row[0])
