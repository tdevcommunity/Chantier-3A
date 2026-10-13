"""Issued ticket rows linked to orders and capability tokens."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from store.store import NotFoundError, Store
from store.timeutil import text_to_null_time, text_to_time


@dataclass
class Ticket:
    """Ticket."""
    id: str
    order_id: str
    event_id: str
    ticket_type_id: str
    holder_user_id: str | None
    holder_name: str
    serial: str
    capability: str
    status: str
    issued_at: datetime
    voided_at: datetime | None = None


def _scan(row) -> Ticket:
    """Internal: scan."""
    if hasattr(row, "keys"):
        return Ticket(
            id=row["id"],
            order_id=row["order_id"],
            event_id=row["event_id"],
            ticket_type_id=row["ticket_type_id"],
            holder_user_id=row["holder_user_id"],
            holder_name=row["holder_name"],
            serial=row["serial"],
            capability=row["capability"],
            status=row["status"],
            issued_at=text_to_time(row["issued_at"]),
            voided_at=text_to_null_time(row["voided_at"]),
        )
    return Ticket(
        id=row[0],
        order_id=row[1],
        event_id=row[2],
        ticket_type_id=row[3],
        holder_user_id=row[4],
        holder_name=row[5],
        serial=row[6],
        capability=row[7],
        status=row[8],
        issued_at=text_to_time(row[9]),
        voided_at=text_to_null_time(row[10]),
    )


def get_ticket_by_id(st: Store, ticket_id: str) -> Ticket:
    """Get ticket by id."""
    row = st.fetchone(
        """
        SELECT id, order_id, event_id, ticket_type_id, holder_user_id, holder_name,
               serial, capability, status, issued_at, voided_at
        FROM tickets WHERE id = ?
        """,
        (ticket_id,),
    )
    if row is None:
        raise NotFoundError()
    return _scan(row)


def list_tickets_for_order(st: Store, order_id: str) -> list[Ticket]:
    """List tickets for order."""
    rows = st.fetchall(
        """
        SELECT id, order_id, event_id, ticket_type_id, holder_user_id, holder_name,
               serial, capability, status, issued_at, voided_at
        FROM tickets WHERE order_id = ? ORDER BY issued_at ASC, id ASC
        """,
        (order_id,),
    )
    return [_scan(r) for r in rows]


def void_valid_tickets_for_order(st: Store, order_id: str, voided_at: datetime) -> int:
    """Mark all valid tickets for an order as void. Returns number of rows updated."""
    from store.timeutil import time_to_text

    return st.execute_rowcount(
        """
        UPDATE tickets
        SET status = 'void', voided_at = ?
        WHERE order_id = ? AND status = 'valid'
        """,
        (time_to_text(voided_at), order_id),
    )


def list_tickets_for_user(st: Store, user_id: str) -> list[Ticket]:
    """List tickets for user."""
    rows = st.fetchall(
        """
        SELECT id, order_id, event_id, ticket_type_id, holder_user_id, holder_name,
               serial, capability, status, issued_at, voided_at
        FROM tickets WHERE holder_user_id = ? ORDER BY issued_at DESC, id DESC
        """,
        (user_id,),
    )
    return [_scan(r) for r in rows]
