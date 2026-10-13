"""Stale pending orders release inventory."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from conftest import seed_published_event
from orders.pending_cleanup import release_stale_pending_orders
from store import orders as orders_repo
from store.timeutil import time_to_text


def test_release_stale_pending_restores_sold(demo_store):
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    order = orders_repo.Order(
        id="01STALEORDER0000000000000001",
        event_id=fx["event_id"],
        user_id=None,
        buyer_email="stale@example.com",
        buyer_name="Stale",
        status="pending",
        subtotal_minor=15000,
        fee_minor=0,
        total_minor=15000,
        currency="EUR",
        provider="stub",
        provider_ref=None,
        created_at=old,
        paid_at=None,
    )
    lines = [
        orders_repo.OrderLine(
            ticket_type_id=fx["ticket_type_id"],
            quantity=1,
            unit_price_minor=15000,
        )
    ]
    orders_repo.create_order_with_items(store, order, lines)
    before = store.fetchone(
        "SELECT quantity_sold FROM ticket_types WHERE id = ?",
        (fx["ticket_type_id"],),
    )
    assert int(before["quantity_sold"]) >= 1

    store.execute(
        "UPDATE orders SET created_at = ? WHERE id = ?",
        (time_to_text(old), order.id),
    )
    n = release_stale_pending_orders(store)
    assert n >= 1
    row = store.fetchone("SELECT status FROM orders WHERE id = ?", (order.id,))
    assert row["status"] == "failed"
    after = store.fetchone(
        "SELECT quantity_sold FROM ticket_types WHERE id = ?",
        (fx["ticket_type_id"],),
    )
    assert int(after["quantity_sold"]) == int(before["quantity_sold"]) - 1
