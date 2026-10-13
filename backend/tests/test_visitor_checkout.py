"""Visitor can browse and buy without an account; staff signup via invite only."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from config import load_config
from store.timeutil import time_to_text


def test_public_signup_disabled_by_default(client: TestClient, monkeypatch):
    monkeypatch.setenv("CHANTIER3A_PUBLIC_SIGNUP", "0")
    cfg = load_config(database_url=client.app.state.config.database_url, demo=False)
    client.app.state.config = cfg
    r = client.post(
        "/api/auth/signup",
        json={"email": "visitor@example.com", "password": "longpassword1", "name": "V"},
    )
    assert r.status_code == 403


def test_guest_checkout_and_lookup(client: TestClient, demo_store):
    store, _cfg, _services, _app = demo_store
    from conftest import seed_published_event
    from events import service as events_svc

    fx = seed_published_event(store)
    events_svc.create_ticket_type(
        store,
        fx["event_id"],
        {
            "name": "T-shirt",
            "price_minor": 2500,
            "quantity_total": 50,
            "max_per_order": 2,
            "status": "active",
            "product_kind": "goodie",
        },
    )

    pub = client.get(f"/api/events/{fx['event_id']}")
    assert pub.status_code == 200
    kinds = {t["product_kind"] for t in pub.json()["ticket_types"]}
    assert "goodie" in kinds

    client.cookies.clear()
    order = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": fx["ticket_type_id"], "quantity": 1}],
            "buyer": {"email": "guest@example.com", "name": "Guest"},
            "provider": "stub",
        },
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["order"]["id"]
    assert order.json()["order"]["total_minor"] == 15000

    verify = client.post(
        "/api/payments/verify",
        json={"reference": order_id, "email": "guest@example.com"},
    )
    assert verify.status_code == 200, verify.text
    assert len(verify.json()["tickets"]) == 1

    guest = client.get(f"/api/orders/{order_id}/guest", params={"email": "guest@example.com"})
    assert guest.status_code == 200
    assert guest.json()["tickets"][0]["serial"].startswith("TDEV-")

    wrong = client.get(f"/api/orders/{order_id}/guest", params={"email": "other@example.com"})
    assert wrong.status_code == 404


def test_site_config_visitor_flags(client: TestClient):
    r = client.get("/api/public/site-config")
    assert r.status_code == 200
    data = r.json()
    assert data["visitor_checkout_without_account"] is True
    assert "public_signup" in data


def test_signup_with_invite_when_public_signup_off(client: TestClient, demo_store, monkeypatch):
    _store, cfg, _services, app = demo_store
    signup = client.post(
        "/api/auth/signup",
        json={"email": "owner@example.com", "password": "longpassword1", "name": "Owner"},
    )
    assert signup.status_code == 200, signup.text
    h = {"Authorization": f"Bearer {signup.json()['token']}"}

    monkeypatch.setenv("CHANTIER3A_PUBLIC_SIGNUP", "0")
    app.state.config = load_config(database_url=cfg.database_url, demo=False)
    org = client.post("/api/orgs", json={"name": "Staff Org", "slug": "staff-org"}, headers=h)
    assert org.status_code == 201, org.text
    org_id = org.json()["org"]["id"]

    inv = client.post(
        f"/api/orgs/{org_id}/invites",
        json={"email": "staff@example.com", "role": "scanner"},
        headers=h,
    )
    assert inv.status_code == 201, inv.text
    token = inv.json()["token"]

    client.cookies.clear()
    blocked = client.post(
        "/api/auth/signup",
        json={"email": "staff@example.com", "password": "longpassword2", "name": "Staff"},
    )
    assert blocked.status_code == 403

    joined = client.post(
        "/api/auth/signup-with-invite",
        json={"token": token, "password": "longpassword2", "name": "Staff"},
    )
    assert joined.status_code == 200, joined.text
    assert joined.json()["user"]["email"] == "staff@example.com"
