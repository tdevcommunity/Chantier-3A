"""Admin participants CSV export."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from conftest import seed_published_event
from events import service as events_svc
from events.passes import STUDENT_PASS_TICKET_TYPE_BODY
from store.timeutil import time_to_text
from tests.test_student_pass import sample_form


def test_export_participants_csv_includes_registration_fields(client: TestClient, demo_store):
    store, _cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    signup = client.post(
        "/api/auth/signup",
        json={"email": "csv-admin@example.com", "password": "longpassword1", "name": "CSV Admin"},
    )
    assert signup.status_code == 200, signup.text
    uid = signup.json()["user"]["id"]
    token = signup.json()["token"]
    now = datetime.now(timezone.utc)
    store.execute(
        "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        (fx["org_id"], uid, "owner", time_to_text(now)),
    )
    admin_h = {"Authorization": f"Bearer {token}"}

    tt = events_svc.create_ticket_type(store, fx["event_id"], STUDENT_PASS_TICKET_TYPE_BODY)
    form = sample_form()
    client.cookies.clear()
    order = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": tt["id"], "quantity": 1}],
            "buyer": {"email": form["email"], "name": "Awa Diallo", "form": form},
        },
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["order"]["id"]
    verify = client.post(
        "/api/payments/verify",
        json={"reference": order_id, "email": form["email"]},
    )
    assert verify.status_code == 200, verify.text

    r = client.get(f"/api/events/{fx['event_id']}/exports/participants.csv", headers=admin_h)
    assert r.status_code == 200, r.text
    text = r.content.decode("utf-8-sig")
    assert "E-mail" in text.split("\r\n")[0]
    assert form["email"] in text
    assert "learn_skills" in text or "Apprendre" in text or "understand_ai" in text
    assert "Oui" in text
