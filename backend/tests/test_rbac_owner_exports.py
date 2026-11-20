"""Owner-only exports and order list; admin receives 403."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from conftest import seed_published_event
from store.timeutil import time_to_text


def _signup_on_app(app, email: str, password: str = "longpassword1") -> tuple[dict, str]:
    with TestClient(app) as isolated:
        res = isolated.post(
            "/api/auth/signup",
            json={"email": email, "password": password, "name": email},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        headers = {"Authorization": f"Bearer {body['token']}"}
        return headers, body["user"]["id"]


def _add_org_member(store, org_id: str, user_id: str, role: str) -> None:
    now = datetime.now(timezone.utc)
    store.execute(
        "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        (org_id, user_id, role, time_to_text(now)),
    )


def test_admin_cannot_export_participants_csv(client: TestClient, demo_store):
    store, _cfg, _services, app = demo_store
    fx = seed_published_event(store)
    owner_h, owner_id = _signup_on_app(app, "owner-export@example.com")
    _add_org_member(store, fx["org_id"], owner_id, "owner")

    admin_h, admin_id = _signup_on_app(app, "admin-export@example.com")
    _add_org_member(store, fx["org_id"], admin_id, "admin")

    r = client.get(f"/api/events/{fx['event_id']}/exports/participants.csv", headers=admin_h)
    assert r.status_code == 403, r.text

    r_owner = client.get(f"/api/events/{fx['event_id']}/exports/participants.csv", headers=owner_h)
    assert r_owner.status_code in (200, 404)


def test_admin_cannot_list_event_orders(client: TestClient, demo_store):
    store, _cfg, _services, app = demo_store
    fx = seed_published_event(store)
    owner_h, owner_id = _signup_on_app(app, "owner-orders@example.com")
    _add_org_member(store, fx["org_id"], owner_id, "owner")

    admin_h, admin_id = _signup_on_app(app, "admin-orders@example.com")
    _add_org_member(store, fx["org_id"], admin_id, "admin")

    r = client.get(f"/api/events/{fx['event_id']}/orders", headers=admin_h)
    assert r.status_code == 403, r.text

    r_owner = client.get(f"/api/events/{fx['event_id']}/orders", headers=owner_h)
    assert r_owner.status_code == 200, r_owner.text