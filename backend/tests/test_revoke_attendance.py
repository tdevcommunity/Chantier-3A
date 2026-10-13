"""Admin revoke-attendance voids tickets and blocks scan."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from store.timeutil import time_to_text


def _auth_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    r = client.post(
        "/api/auth/signup",
        json={"email": email, "password": password, "name": "Revoke E2E"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _paid_order(client: TestClient, demo_store) -> tuple[str, str, str, str, dict]:
    _store, _cfg, _services, _app = demo_store
    suffix = uuid.uuid4().hex[:8]
    h = _auth_headers(client, f"revoke-org-{suffix}@example.com", "longpassword1")
    org = client.post(
        "/api/orgs",
        json={"name": f"Revoke Org {suffix}", "slug": f"revoke-org-{suffix}"},
        headers=h,
    )
    assert org.status_code == 201, org.text
    org_id = org.json()["org"]["id"]

    now = datetime.now(timezone.utc)
    ev = client.post(
        "/api/events",
        json={
            "org_id": org_id,
            "slug": f"revoke-ev-{suffix}",
            "title": "Revoke Event",
            "starts_at": time_to_text(now - timedelta(hours=1)),
            "ends_at": time_to_text(now + timedelta(hours=5)),
        },
        headers=h,
    )
    assert ev.status_code == 201, ev.text
    event_id = ev.json()["event"]["id"]
    assert client.post(f"/api/events/{event_id}/publish", headers=h).status_code == 200

    tt = client.post(
        f"/api/events/{event_id}/ticket-types",
        json={
            "name": "GA",
            "price_minor": 500,
            "quantity_total": 20,
            "max_per_order": 4,
            "access_event": True,
            "access_food": True,
            "access_merch": True,
            "access_after": True,
        },
        headers=h,
    )
    assert tt.status_code == 201, tt.text
    tt_id = tt.json()["ticket_type"]["id"]

    client.cookies.clear()
    order = client.post(
        "/api/orders",
        json={
            "event_id": event_id,
            "items": [{"ticket_type_id": tt_id, "quantity": 1}],
            "buyer": {"email": f"revoke-buyer-{suffix}@example.com", "name": "Buyer"},
            "provider": "manual",
        },
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["order"]["id"]

    mark = client.post(f"/api/orders/{order_id}/mark-paid", headers=h)
    assert mark.status_code == 200, mark.text
    ticket = mark.json()["tickets"][0]
    return event_id, order_id, ticket["id"], ticket["capability"], h


def test_revoke_attendance_voids_and_blocks_scan(client: TestClient, demo_store):
    event_id, order_id, _ticket_id, capability, h = _paid_order(client, demo_store)

    revoke = client.post(f"/api/orders/{order_id}/revoke-attendance", headers=h)
    assert revoke.status_code == 200, revoke.text
    tickets = revoke.json()["tickets"]
    assert len(tickets) >= 1
    assert all(t["status"] == "void" for t in tickets)

    scan = client.post(
        "/api/scan",
        json={"event_id": event_id, "capability": capability},
        headers=h,
    )
    assert scan.status_code == 200
    assert scan.json()["result"] == "invalid"


def test_revoke_attendance_idempotent(client: TestClient, demo_store):
    _event_id, order_id, _tid, _cap, h = _paid_order(client, demo_store)
    first = client.post(f"/api/orders/{order_id}/revoke-attendance", headers=h)
    assert first.status_code == 200
    second = client.post(f"/api/orders/{order_id}/revoke-attendance", headers=h)
    assert second.status_code == 200
    assert all(t["status"] == "void" for t in second.json()["tickets"])


def test_revoke_attendance_rejects_pending(client: TestClient, demo_store):
    _store, _cfg, _services, _app = demo_store
    suffix = uuid.uuid4().hex[:8]
    h = _auth_headers(client, f"revoke-pend-{suffix}@example.com", "longpassword1")
    org = client.post(
        "/api/orgs",
        json={"name": f"Pend Org {suffix}", "slug": f"pend-org-{suffix}"},
        headers=h,
    )
    org_id = org.json()["org"]["id"]
    now = datetime.now(timezone.utc)
    ev = client.post(
        "/api/events",
        json={
            "org_id": org_id,
            "slug": f"pend-ev-{suffix}",
            "title": "Pend",
            "starts_at": time_to_text(now - timedelta(hours=1)),
            "ends_at": time_to_text(now + timedelta(hours=5)),
        },
        headers=h,
    )
    event_id = ev.json()["event"]["id"]
    client.post(f"/api/events/{event_id}/publish", headers=h)
    tt = client.post(
        f"/api/events/{event_id}/ticket-types",
        json={
            "name": "GA",
            "price_minor": 500,
            "quantity_total": 5,
            "max_per_order": 1,
            "access_event": True,
            "access_food": True,
            "access_merch": True,
            "access_after": True,
        },
        headers=h,
    )
    tt_id = tt.json()["ticket_type"]["id"]
    client.cookies.clear()
    order = client.post(
        "/api/orders",
        json={
            "event_id": event_id,
            "items": [{"ticket_type_id": tt_id, "quantity": 1}],
            "buyer": {"email": f"pend-{suffix}@example.com", "name": "P"},
            "provider": "manual",
        },
    )
    order_id = order.json()["order"]["id"]
    r = client.post(f"/api/orders/{order_id}/revoke-attendance", headers=h)
    assert r.status_code == 409
