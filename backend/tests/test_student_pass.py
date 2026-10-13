"""Free student pass tier and checkout."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import seed_published_event
from events import service as events_svc
from events.passes import (
    PASS_TIER_PRICE_MINOR,
    STANDARD_PASS_TICKET_TYPE_BODY,
    STUDENT_PASS_TICKET_TYPE_BODY,
    VIP_PASS_TICKET_TYPE_BODY,
)


def sample_form(**overrides) -> dict:
    form = {
        "last_name": "Diallo",
        "first_name": "Awa",
        "age_range": "18_24",
        "gender": "woman",
        "country": "Togo",
        "city": "Lomé",
        "phone": "90000000",
        "email": "student@school.edu",
        "situation": "student",
        "activity_domain": "Informatique",
        "school_program": "Universite Cheikh Anta Diop",
        "digital_level": "learning",
        "participation_reasons": ["learn_skills", "understand_ai"],
        "topics": ["ai", "software"],
        "expectations": "Mieux comprendre l'entrepreneuriat tech.",
        "prior_participation": "first_time",
        "discovery_channel": "school",
        "stay_informed": True,
        "preferred_channel": "email",
        "consent_data_processing": True,
        "consent_marketing": False,
    }
    form.update(overrides)
    return form


def test_pass_tier_catalog(client: TestClient):
    """Student, standard and VIP passes are listed with catalog prices."""
    resp = client.get("/api/pass-tiers")
    assert resp.status_code == 200
    tiers = resp.json()["pass_tiers"]
    assert len(tiers) == 3
    by_id = {t["id"]: t for t in tiers}
    assert by_id["student"]["price_minor"] == 0
    assert by_id["standard"]["price_minor"] == PASS_TIER_PRICE_MINOR["standard"]
    assert by_id["vip"]["price_minor"] == PASS_TIER_PRICE_MINOR["vip"]


def test_standard_and_vip_pass_can_be_created(demo_store):
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    std = events_svc.create_ticket_type(store, fx["event_id"], STANDARD_PASS_TICKET_TYPE_BODY)
    vip = events_svc.create_ticket_type(store, fx["event_id"], VIP_PASS_TICKET_TYPE_BODY)
    assert std["pass_tier"] == "standard"
    assert std["price_minor"] == 2000
    assert vip["pass_tier"] == "vip"
    assert vip["price_minor"] == 5000


def test_student_pass_requires_registration(client: TestClient, demo_store):
    """Student pass checkout rejects incomplete registration."""
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    tt = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    resp = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
            "buyer": {"email": "incomplete@school.edu"},
        },
    )
    assert resp.status_code == 400


def test_free_student_pass_checkout(client: TestClient, demo_store):
    """Buyers obtain a student pass without a payment step."""
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    tt = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    assert tt["pass_tier"] == "student"
    assert tt["price_minor"] == 0

    order = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
            "buyer": {
                "email": "student@school.edu",
                "first_name": "Awa",
                "last_name": "Diallo",
                "form": sample_form(),
            },
        },
    )
    assert order.status_code == 201, order.text
    body = order.json()
    assert body["order"]["total_minor"] == 0
    assert body["order"]["provider"] == "free"

    email = "student@school.edu"
    verify = client.post(
        "/api/payments/verify",
        json={"reference": body["order"]["id"], "email": email},
    )
    assert verify.status_code == 200, verify.text
    assert verify.json()["order"]["status"] == "paid"
    assert "registration" not in verify.json()["order"]
    tickets = verify.json()["tickets"]
    assert len(tickets) == 1
    assert tickets[0]["serial"].startswith("TDEV-")

    guest = client.get(f"/api/orders/{body['order']['id']}/guest", params={"email": email})
    assert guest.status_code == 200
    reg = guest.json()["order"]["registration"]
    assert reg["school_name"] == "Universite Cheikh Anta Diop"
    assert reg["wish"]
    assert reg["form"]["city"] == "Lomé"
    assert reg["form"]["phone"] == "90000000"


def test_student_pass_rejects_plus_alias_duplicate(client: TestClient, demo_store):
    """Plus-addressing must not bypass one registration per canonical email."""
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    tt = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    base = "pentest-sec@example.com"
    first = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
            "buyer": {"email": base, "form": sample_form(email=base)},
        },
    )
    assert first.status_code == 201, first.text
    client.post(
        "/api/payments/verify",
        json={"reference": first.json()["order"]["id"], "email": base},
    )

    alias = "pentest-sec+1@example.com"
    second = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
            "buyer": {"email": alias, "form": sample_form(email=alias)},
        },
    )
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "duplicate_registration"


def test_student_pass_rejects_duplicate_email(client: TestClient, demo_store):
    """Same email cannot register twice on the same event."""
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    tt = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    payload = {
        "event_id": fx["event_id"],
        "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
        "buyer": {
            "email": "dup@example.com",
            "form": sample_form(email="dup@example.com"),
        },
    }
    first = client.post("/api/orders", json=payload)
    assert first.status_code == 201, first.text
    client.post(
        "/api/payments/verify",
        json={"reference": first.json()["order"]["id"], "email": "dup@example.com"},
    )

    second = client.post("/api/orders", json=payload)
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "duplicate_registration"


def test_vip_pass_issues_festival_and_nexus_tickets(client: TestClient, demo_store):
    """A 5000 FCFA Nexus order also issues the free festival pass."""
    from datetime import datetime, timezone

    from payments import types as pt

    store, _cfg, services, _app = demo_store
    fx = seed_published_event(store, price_minor=5000)
    student = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    vip = events_svc.create_ticket_type(store, fx["event_id"], VIP_PASS_TICKET_TYPE_BODY)

    order = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": vip["id"], "quantity": 1}],
            "buyer": {"email": "nexus@example.com", "form": sample_form(email="nexus@example.com")},
            "provider": "manual",
        },
    )
    assert order.status_code == 201, order.text
    assert order.json()["order"]["total_minor"] == 5000
    order_id = order.json()["order"]["id"]
    currency = order.json()["order"]["currency"]

    view, tickets = services.orders.settle(
        pt.Result(
            provider="manual",
            reference=order_id,
            status=pt.Status.PAID,
            amount_minor=5000,
            currency=currency,
            paid_at=datetime.now(timezone.utc),
        )
    )
    assert view.status == "paid"
    types = {t.ticket_type_id for t in tickets}
    assert student["id"] in types
    assert vip["id"] in types
    assert len(tickets) == 2
