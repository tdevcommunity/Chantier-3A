"""Release inventory held by abandoned pending checkouts."""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from store import orders as orders_repo
from store.store import Store

log = logging.getLogger("chantier3a.pending_cleanup")

DEFAULT_TTL_MINUTES = 45
DEFAULT_INTERVAL_SECONDS = 300


def _ttl_minutes() -> int:
    raw = os.getenv("CHANTIER3A_PENDING_ORDER_TTL_MINUTES", str(DEFAULT_TTL_MINUTES)).strip()
    try:
        return max(5, int(raw))
    except ValueError:
        return DEFAULT_TTL_MINUTES


def release_stale_pending_orders(st: Store) -> int:
    """Fail pending orders older than TTL and restore ticket inventory."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=_ttl_minutes())
    cutoff_text = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = st.fetchall(
        """
        SELECT id FROM orders
        WHERE status = 'pending' AND created_at < ?
        """,
        (cutoff_text,),
    )
    released = 0
    for row in rows:
        oid = row["id"] if hasattr(row, "keys") else row[0]
        if orders_repo.cancel_order_release_inventory(st, oid):
            released += 1
    return released


def start_pending_cleanup_loop(st: Store) -> None:
    """Background thread: periodic stale pending release (no-op in tests if disabled)."""
    if os.getenv("CHANTIER3A_DISABLE_PENDING_CLEANUP", "").strip().lower() in ("1", "true", "yes"):
        return
    interval = DEFAULT_INTERVAL_SECONDS

    def _loop() -> None:
        while True:
            try:
                n = release_stale_pending_orders(st)
                if n:
                    log.info("released %s stale pending order(s)", n)
            except Exception:
                log.exception("pending order cleanup failed")
            time.sleep(interval)

    thread = threading.Thread(target=_loop, name="pending-order-cleanup", daemon=True)
    thread.start()
