"""Order header persistence and status transitions."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from auth.email_canonical import canonical_email
from store import order_items as order_items_repo
from store.rebind import rebind_query
from store.store import NotFoundError, SoldOutError, Store, new_ulid
from store.timeutil import text_to_null_time, text_to_time, time_to_text


def _buyer_email_key(email: str) -> str:
    """Canonical form used for uniqueness and guest lookup."""
    try:
        return canonical_email(email)
    except ValueError:
        return email.strip().lower()


@dataclass
class Order:
    """Order."""
    id: str
    event_id: str
    user_id: str | None
    buyer_email: str
    buyer_name: str
    status: str
    subtotal_minor: int
    fee_minor: int
    total_minor: int
    currency: str
    provider: str
    provider_ref: str | None
    created_at: datetime
    paid_at: datetime | None
    buyer_first_name: str = ""
    buyer_last_name: str = ""
    school_name: str = ""
    motivation: str = ""
    wish: str = ""
    registration_form: str = "{}"


@dataclass
class OrderLine:
    """Orderline."""
    ticket_type_id: str
    quantity: int
    unit_price_minor: int


def _scan_order(row) -> Order:
    """Internal: scan order."""
    if hasattr(row, "keys"):
        return Order(
            id=row["id"],
            event_id=row["event_id"],
            user_id=row["user_id"],
            buyer_email=row["buyer_email"],
            buyer_name=row["buyer_name"],
            buyer_first_name=row["buyer_first_name"] or "",
            buyer_last_name=row["buyer_last_name"] or "",
            school_name=row["school_name"] or "",
            motivation=row["motivation"] or "",
            wish=row["wish"] or "",
            status=row["status"],
            subtotal_minor=int(row["subtotal_minor"]),
            fee_minor=int(row["fee_minor"]),
            total_minor=int(row["total_minor"]),
            currency=row["currency"],
            provider=row["provider"],
            provider_ref=row["provider_ref"],
            created_at=text_to_time(row["created_at"]),
            paid_at=text_to_null_time(row["paid_at"]),
            registration_form=row["registration_form"] or "{}",
        )
    return Order(
        id=row[0],
        event_id=row[1],
        user_id=row[2],
        buyer_email=row[3],
        buyer_name=row[4],
        buyer_first_name=row[5] or "",
        buyer_last_name=row[6] or "",
        school_name=row[7] or "",
        motivation=row[8] or "",
        wish=row[9] or "",
        status=row[10],
        subtotal_minor=int(row[11]),
        fee_minor=int(row[12]),
        total_minor=int(row[13]),
        currency=row[14],
        provider=row[15],
        provider_ref=row[16],
        created_at=text_to_time(row[17]),
        paid_at=text_to_null_time(row[18]),
        registration_form=row[19] or "{}",
    )


_ORDER_SELECT = """
        SELECT id, event_id, user_id, buyer_email, buyer_name,
               buyer_first_name, buyer_last_name, school_name, motivation, wish,
               status, subtotal_minor, fee_minor, total_minor, currency, provider,
               provider_ref, created_at, paid_at, registration_form
"""


def get_order_by_id(st: Store, order_id: str) -> Order:
    """Get order by id."""
    row = st.fetchone(
        f"""
        {_ORDER_SELECT}
        FROM orders WHERE id = ?
        """,
        (order_id,),
    )
    if row is None:
        raise NotFoundError()
    return _scan_order(row)


def list_orders_for_user(st: Store, user_id: str) -> list[Order]:
    """List orders for user."""
    rows = st.fetchall(
        f"""
        {_ORDER_SELECT}
        FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC
        """,
        (user_id,),
    )
    return [_scan_order(r) for r in rows]


def list_orders_for_event(st: Store, event_id: str) -> list[Order]:
    """List orders for event."""
    rows = st.fetchall(
        f"""
        {_ORDER_SELECT}
        FROM orders WHERE event_id = ? ORDER BY created_at DESC, id DESC
        """,
        (event_id,),
    )
    return [_scan_order(r) for r in rows]


def has_active_order_for_event_email(st: Store, event_id: str, email: str) -> bool:
    """True if this email already has a paid order on the event (pending may be replaced)."""
    normalized = _buyer_email_key(email)
    if not normalized:
        return False
    row = st.fetchone(
        """
        SELECT id FROM orders
        WHERE event_id = ? AND buyer_email = ?
          AND status = 'paid'
        LIMIT 1
        """,
        (event_id, normalized),
    )
    return row is not None


def cancel_pending_orders_for_event_email(st: Store, event_id: str, email: str) -> int:
    """Release inventory and fail abandoned checkout attempts for the same e-mail."""
    normalized = _buyer_email_key(email)
    if not normalized:
        return 0
    rows = st.fetchall(
        """
        SELECT id FROM orders
        WHERE event_id = ? AND buyer_email = ? AND status = 'pending'
        """,
        (event_id, normalized),
    )
    n = 0
    for row in rows:
        oid = row["id"] if hasattr(row, "keys") else row[0]
        if cancel_order_release_inventory(st, oid):
            n += 1
    return n


def _tx_exec(st: Store, conn, query: str, args: tuple) -> int:
    """Internal: tx exec."""
    q = rebind_query(query)
    cur = conn.execute(q, args)
    return cur.rowcount


def create_order_with_items(
    st: Store, order: Order, lines: list[OrderLine]
) -> list[order_items_repo.OrderItem]:
    """Create order with items."""
    if not lines:
        raise ValueError("store: create order: no line items")
    if not order.id:
        order.id = new_ulid()
    if not order.created_at:
        order.created_at = datetime.now(timezone.utc)
    if not order.status:
        order.status = "pending"

    conn = st.primary
    with st.transaction():
        return _create_order_tx(st, conn, order, lines)


def _create_order_tx(st, conn, order: Order, lines: list[OrderLine]):
    """Internal: create order tx."""
    for ln in lines:
        if ln.quantity <= 0:
            raise ValueError("non-positive quantity")
        n = _tx_exec(
            st,
            conn,
            """
            UPDATE ticket_types
            SET quantity_sold = quantity_sold + ?
            WHERE id = ?
              AND (quantity_total = 0 OR quantity_sold + ? <= quantity_total)
            """,
            (ln.quantity, ln.ticket_type_id, ln.quantity),
        )
        if n == 0:
            exists = conn.execute(
                rebind_query("SELECT COUNT(*) FROM ticket_types WHERE id = ?"),
                (ln.ticket_type_id,),
            ).fetchone()
            cnt = exists[0] if exists is not None else 0
            if int(cnt) == 0:
                raise NotFoundError()
            raise SoldOutError()

    _tx_exec(
        st,
        conn,
        """
        INSERT INTO orders (id, event_id, user_id, buyer_email, buyer_name,
            buyer_first_name, buyer_last_name, school_name, motivation, wish,
            status, subtotal_minor, fee_minor, total_minor, currency, provider, provider_ref,
            created_at, paid_at, registration_form)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            order.id,
            order.event_id,
            order.user_id,
            order.buyer_email,
            order.buyer_name,
            order.buyer_first_name,
            order.buyer_last_name,
            order.school_name,
            order.motivation,
            order.wish,
            order.status,
            order.subtotal_minor,
            order.fee_minor,
            order.total_minor,
            order.currency,
            order.provider,
            order.provider_ref,
            time_to_text(order.created_at),
            time_to_text(order.paid_at) if order.paid_at else None,
            order.registration_form or "{}",
        ),
    )

    items: list[order_items_repo.OrderItem] = []
    for ln in lines:
        item_id = new_ulid()
        _tx_exec(
            st,
            conn,
            """
            INSERT INTO order_items (id, order_id, ticket_type_id, quantity, unit_price_minor)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item_id, order.id, ln.ticket_type_id, ln.quantity, ln.unit_price_minor),
        )
        items.append(
            order_items_repo.OrderItem(
                id=item_id,
                order_id=order.id,
                ticket_type_id=ln.ticket_type_id,
                quantity=ln.quantity,
                unit_price_minor=ln.unit_price_minor,
            )
        )
    return items


def cancel_order_release_inventory(st: Store, order_id: str) -> bool:
    """Cancel order release inventory."""
    conn = st.primary
    with st.transaction():
        return _cancel_order_tx(st, conn, order_id)


def _cancel_order_tx(st, conn, order_id: str) -> bool:
    """Internal: cancel order tx."""
    n = _tx_exec(
        st,
        conn,
        "UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'",
        (order_id,),
    )
    if n == 0:
        return False
    q = rebind_query("SELECT ticket_type_id, quantity FROM order_items WHERE order_id = ?")
    rows = conn.execute(q, (order_id,)).fetchall()
    for row in rows:
        tt_id = row["ticket_type_id"] if hasattr(row, "keys") else row[0]
        qty = row["quantity"] if hasattr(row, "keys") else row[1]
        _tx_exec(
            st,
            conn,
            "UPDATE ticket_types SET quantity_sold = quantity_sold - ? WHERE id = ?",
            (qty, tt_id),
        )
    return True


def update_provider_ref(st: Store, order_id: str, provider_ref: str) -> None:
    """Persist Velto (or other) transaction id on a pending order after checkout begins."""
    ref = provider_ref.strip()
    if not ref:
        return
    conn = st.primary
    conn.execute(
        rebind_query(
            "UPDATE orders SET provider_ref = ? WHERE id = ? AND status = 'pending'"
        ),
        (ref, order_id),
    )


def settle_order(
    st: Store,
    order_id: str,
    paid_at: datetime,
    tickets: list | None = None,
    *,
    mint: Callable[[Any], list] | None = None,
) -> bool:
    """Settle order."""
    conn = st.primary
    with st.transaction():
        return _settle_order_tx(st, conn, order_id, paid_at, tickets, mint)


def _settle_order_tx(
    st,
    conn,
    order_id: str,
    paid_at: datetime,
    tickets: list | None,
    mint: Callable[[Any], list] | None = None,
) -> bool:
    """Internal: settle order tx."""
    from store import tickets as tickets_repo

    n = _tx_exec(
        st,
        conn,
        "UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'",
        (time_to_text(paid_at), order_id),
    )
    if n == 0:
        return False
    if mint is not None:
        tickets = mint(conn)
    if not tickets:
        return True
    for t in tickets:
        if isinstance(t, tickets_repo.Ticket):
            tk = t
        else:
            tk = t
        tid = tk.id or new_ulid()
        status = tk.status or "valid"
        _tx_exec(
            st,
            conn,
            """
            INSERT INTO tickets (id, order_id, event_id, ticket_type_id, holder_user_id,
                holder_name, serial, capability, status, issued_at, voided_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tid,
                tk.order_id,
                tk.event_id,
                tk.ticket_type_id,
                tk.holder_user_id,
                tk.holder_name,
                tk.serial,
                tk.capability,
                status,
                time_to_text(tk.issued_at),
                time_to_text(tk.voided_at) if tk.voided_at else None,
            ),
        )
    return True
