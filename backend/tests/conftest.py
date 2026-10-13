"""Pytest fixtures: throwaway SQLite store by default, app, and seeded published events.

Set ``TEST_DATABASE_URL`` to a PostgreSQL URL to run against PostgreSQL instead. The database
name must end with ``_test``: the fixture truncates every table, so real databases are refused.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

import config as config_module

# Never let a developer's backend/.env (real FedaPay/SMTP keys, PAYMENT_PROVIDERS...) leak into
# tests: mark it as already loaded and drop anything already exported by the shell.
config_module._ENV_LOADED = True
for _key in [k for k in os.environ if k.startswith("CHANTIER3A_")]:
    del os.environ[_key]
os.environ["CHANTIER3A_DISABLE_PENDING_CLEANUP"] = "1"

from bootstrap import build_services  # noqa: E402
from config import load_config  # noqa: E402
from http_layer.app import create_app  # noqa: E402
from store import event_keys as event_keys_repo  # noqa: E402
from store.store import Store, new_ulid, open_postgres  # noqa: E402
from store.timeutil import time_to_text  # noqa: E402
from sqlite_store import open_sqlite_store  # noqa: E402

_PG_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
# Only passed to load_config (never connected to) when running on SQLite.
TEST_DATABASE_URL = _PG_URL or "sqlite:///:memory:"


def _require_disposable_postgres(url: str) -> None:
    """Refuse PostgreSQL databases that are not explicitly named ``*_test``."""
    name = urlparse(url).path.lstrip("/")
    if not name.endswith("_test"):
        raise pytest.UsageError(
            f"TEST_DATABASE_URL must point to a database named '*_test' (got '{name}'): "
            "the test suite truncates every table."
        )


def _truncate_public_tables(store: Store) -> None:
    """Clear application data between tests (PostgreSQL mode; keep schema_migrations)."""
    rows = store.fetchall(
        """
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename != 'schema_migrations'
        """
    )
    if not rows:
        return
    names = [r["tablename"] if hasattr(r, "keys") else r[0] for r in rows]
    quoted = ", ".join(f'"{n}"' for n in names)
    store.execute(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE")


@pytest.fixture()
def demo_store(tmp_path):
    """Pytest fixture yielding store, config, services, and FastAPI app (demo mode)."""
    if _PG_URL:
        _require_disposable_postgres(_PG_URL)
        try:
            store = open_postgres(_PG_URL)
        except Exception as exc:
            pytest.skip(f"PostgreSQL requis pour TEST_DATABASE_URL ({exc})")
        _truncate_public_tables(store)
    else:
        store = open_sqlite_store(tmp_path / "test.db")
    cfg = load_config(database_url=TEST_DATABASE_URL, demo=True)
    services = build_services(store, cfg)
    app = create_app(store, cfg, services)
    yield store, cfg, services, app
    store.close()


@pytest.fixture()
def client(demo_store):
    """FastAPI test client bound to the demo app."""
    _store, _cfg, _services, app = demo_store
    return TestClient(app)


def seed_published_event(store, *, price_minor: int = 15000) -> dict:
    """Insert a minimal org, published event, and ticket type for tests."""
    org_id = new_ulid()
    now = datetime.now(timezone.utc)
    store.execute(
        """
        INSERT INTO orgs (id, name, slug, default_currency, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (org_id, "Test Org", "test-org", "EUR", time_to_text(now)),
    )
    event_id = new_ulid()
    starts = now + timedelta(days=30)
    ends = starts + timedelta(hours=4)
    pub, priv = event_keys_repo.generate_ed25519_keypair()
    event_keys_repo.create_event_with_key(
        store,
        {
            "id": event_id,
            "org_id": org_id,
            "slug": "test-event",
            "title": "Test Event",
            "starts_at": time_to_text(starts),
            "ends_at": time_to_text(ends),
            "currency": "EUR",
            "status": "published",
        },
        pub,
        priv,
    )
    tt_id = new_ulid()
    store.execute(
        """
        INSERT INTO ticket_types (
            id, event_id, name, description, price_minor, quantity_total, quantity_sold,
            sales_start, sales_end, max_per_order, status, sort_order, product_kind
        ) VALUES (?, ?, ?, '', ?, ?, 0, NULL, NULL, ?, 'active', 0, 'ticket')
        """,
        (tt_id, event_id, "General", price_minor, 50, 5),
    )
    return {"org_id": org_id, "event_id": event_id, "ticket_type_id": tt_id}
