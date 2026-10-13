"""Security hardening for POST /api/payments/verify."""

from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import seed_published_event
from events import service as events_svc
from events.passes import STUDENT_PASS_TICKET_TYPE_BODY
from tests.test_student_pass import sample_form


def _free_order(client: TestClient, store) -> tuple[str, str]:
    fx = seed_published_event(store)
    tt = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    email = "verify-harden@example.com"
    resp = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
            "buyer": {"email": email, "form": sample_form(email=email)},
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["order"]["id"], email


def test_verify_requires_email(client: TestClient, demo_store):
    store, _cfg, _services, _app = demo_store
    order_id, _email = _free_order(client, store)
    r = client.post("/api/payments/verify", json={"reference": order_id})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"


def test_verify_wrong_email_not_found(client: TestClient, demo_store):
    store, _cfg, _services, _app = demo_store
    order_id, _email = _free_order(client, store)
    r = client.post(
        "/api/payments/verify",
        json={"reference": order_id, "email": "other@example.com"},
    )
    assert r.status_code == 404


def test_verify_success_omits_registration_pii(client: TestClient, demo_store):
    store, _cfg, _services, _app = demo_store
    order_id, email = _free_order(client, store)
    r = client.post("/api/payments/verify", json={"reference": order_id, "email": email})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "registration" not in body["order"]
    assert body["tickets"][0]["capability"]
