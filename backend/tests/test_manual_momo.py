"""Manual Mobile Money payment: declaration, fees, staff validation / rejection."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from orders import pending_cleanup
from payments import manual_momo as mm
from store.timeutil import time_to_text


# --- fee grid -----------------------------------------------------------------


def test_withdrawal_fee_grid():
    assert mm.withdrawal_fee(mm.OPERATOR_XPRESS, 5000) == 0
    assert mm.withdrawal_fee(mm.OPERATOR_MIXX, 5000) == 100
    assert mm.withdrawal_fee(mm.OPERATOR_MOOV, 5000) == 100
    # tranche boundaries
    assert mm.withdrawal_fee(mm.OPERATOR_MIXX, 5001) == 300
    assert mm.withdrawal_fee(mm.OPERATOR_MOOV, 5001) == 280
    assert mm.withdrawal_fee(mm.OPERATOR_MOOV, 1000) == 75
    # above the last tranche keeps the last fee
    assert mm.withdrawal_fee(mm.OPERATOR_MIXX, 900_000) == 4_200
    assert mm.withdrawal_fee(mm.OPERATOR_MOOV, 0) == 0


def test_withdrawal_fee_rejects_unknown_operator():
    with pytest.raises(mm.ManualMomoError):
        mm.withdrawal_fee("paypal", 5000)


def test_validate_declaration_normalizes_and_checks():
    op, ref, phone = mm.validate_declaration("moov_money", " ab-12 34x ", "+228 90 00 00 00")
    assert (op, ref, phone) == ("moov_money", "AB-1234X", "+22890000000")
    with pytest.raises(mm.ManualMomoError):
        mm.validate_declaration("moov_money", "abc", "90000000")
    with pytest.raises(mm.ManualMomoError):
        mm.validate_declaration("moov_money", "ABC12345", "12")
    with pytest.raises(mm.ManualMomoError):
        mm.validate_declaration("", "ABC12345", "90000000")


def test_manual_options_endpoint(client: TestClient):
    r = client.get("/api/payments/manual-options", params={"amount_minor": 5000})
    assert r.status_code == 200, r.text
    ops = {o["code"]: o for o in r.json()["operators"]}
    assert ops["xpress"]["merchant_number"] == "140983480002"
    assert ops["mixx_by_yas"]["merchant_number"] == "92451589"
    assert ops["moov_money"]["merchant_number"] == "79645440"
    assert ops["xpress"]["total_minor"] == 5000
    assert ops["mixx_by_yas"]["total_minor"] == 5100
    assert ops["moov_money"]["fee_minor"] == 100


# --- order flow ---------------------------------------------------------------


def _auth(client: TestClient, email: str) -> dict[str, str]:
    r = client.post(
        "/api/auth/signup",
        json={"email": email, "password": "longpassword1", "name": "Momo Admin"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _setup(client: TestClient) -> tuple[str, str, dict[str, str]]:
    suffix = uuid.uuid4().hex[:8]
    h = _auth(client, f"momo-admin-{suffix}@example.com")
    org = client.post("/api/orgs", json={"name": f"Momo {suffix}", "slug": f"momo-{suffix}"}, headers=h)
    assert org.status_code == 201, org.text
    now = datetime.now(timezone.utc)
    ev = client.post(
        "/api/events",
        json={
            "org_id": org.json()["org"]["id"],
            "slug": f"momo-ev-{suffix}",
            "title": "Momo Event",
            "starts_at": time_to_text(now + timedelta(days=1)),
            "ends_at": time_to_text(now + timedelta(days=2)),
        },
        headers=h,
    )
    assert ev.status_code == 201, ev.text
    event_id = ev.json()["event"]["id"]
    assert client.post(f"/api/events/{event_id}/publish", headers=h).status_code == 200
    tt = client.post(
        f"/api/events/{event_id}/ticket-types",
        json={"name": "Nexus", "price_minor": 5000, "quantity_total": 2, "max_per_order": 1},
        headers=h,
    )
    assert tt.status_code == 201, tt.text
    client.cookies.clear()
    return event_id, tt.json()["ticket_type"]["id"], h


def _order(client, event_id, tt_id, email, *, operator="moov_money", reference="MP240101ABC", phone="90000000"):
    return client.post(
        "/api/orders",
        json={
            "event_id": event_id,
            "items": [{"ticket_type_id": tt_id, "quantity": 1}],
            "buyer": {"email": email, "name": "Buyer Momo"},
            "provider": "manual_momo",
            "manual_payment": {"operator": operator, "reference": reference, "phone": phone},
        },
    )


@pytest.fixture()
def notify_calls(demo_store, monkeypatch):
    _store, _cfg, services, _app = demo_store
    calls = {"paid": [], "rejected": []}
    monkeypatch.setattr(services.notify, "on_order_paid", lambda oid: calls["paid"].append(oid))
    monkeypatch.setattr(services.notify, "on_order_rejected", lambda oid: calls["rejected"].append(oid))
    return calls


def test_create_manual_order_adds_fee_and_sends_nothing(client: TestClient, notify_calls):
    event_id, tt_id, _h = _setup(client)
    r = _order(client, event_id, tt_id, "buyer1@example.com", operator="moov_money")
    assert r.status_code == 201, r.text
    order = r.json()["order"]
    assert order["status"] == "pending"
    assert order["subtotal_minor"] == 5000
    assert order["fee_minor"] == 100
    assert order["total_minor"] == 5100
    assert order["manual_payment"]["reference"] == "MP240101ABC"
    assert order["manual_payment"]["operator"] == "moov_money"
    assert notify_calls["paid"] == []


def test_xpress_has_no_fee(client: TestClient):
    event_id, tt_id, _h = _setup(client)
    r = _order(client, event_id, tt_id, "buyer2@example.com", operator="xpress")
    assert r.status_code == 201, r.text
    assert r.json()["order"]["fee_minor"] == 0
    assert r.json()["order"]["total_minor"] == 5000


def test_manual_declaration_is_required_and_validated(client: TestClient):
    event_id, tt_id, _h = _setup(client)
    bad_ref = _order(client, event_id, tt_id, "buyer3@example.com", reference="abc")
    assert bad_ref.status_code == 400, bad_ref.text
    bad_op = _order(client, event_id, tt_id, "buyer3@example.com", operator="paypal")
    assert bad_op.status_code == 400, bad_op.text
    missing = client.post(
        "/api/orders",
        json={
            "event_id": event_id,
            "items": [{"ticket_type_id": tt_id, "quantity": 1}],
            "buyer": {"email": "buyer3@example.com", "name": "B"},
            "provider": "manual_momo",
        },
    )
    assert missing.status_code == 400, missing.text


def test_duplicate_reference_rejected(client: TestClient):
    event_id, tt_id, _h = _setup(client)
    assert _order(client, event_id, tt_id, "a@example.com", reference="SAMEREF123").status_code == 201
    dup = _order(client, event_id, tt_id, "b@example.com", reference="sameref123")
    assert dup.status_code == 409, dup.text
    assert dup.json()["error"]["code"] == "payment_reference_used"


def test_pending_declaration_blocks_resubmission_for_same_email(client: TestClient):
    event_id, tt_id, _h = _setup(client)
    assert _order(client, event_id, tt_id, "c@example.com", reference="FIRSTREF11").status_code == 201
    again = _order(client, event_id, tt_id, "c@example.com", reference="SECONDREF2")
    assert again.status_code == 409, again.text
    assert again.json()["error"]["code"] == "pending_verification"


def test_buyer_cannot_confirm_or_abandon_manual_order(client: TestClient):
    event_id, tt_id, _h = _setup(client)
    order = _order(client, event_id, tt_id, "d@example.com", reference="BUYERTRY01").json()["order"]
    verify = client.post("/api/payments/verify", json={"reference": order["id"], "email": "d@example.com"})
    assert verify.status_code == 402, verify.text
    abandon = client.post("/api/payments/abandon", json={"reference": order["id"], "email": "d@example.com"})
    assert abandon.status_code == 200
    assert abandon.json()["released"] is False
    got = client.get(f"/api/orders/{order['id']}/guest", params={"email": "d@example.com"})
    assert got.json()["order"]["status"] == "pending"


def test_validate_issues_tickets_and_notifies(client: TestClient, notify_calls):
    event_id, tt_id, h = _setup(client)
    order = _order(client, event_id, tt_id, "e@example.com", reference="VALIDATE01").json()["order"]
    assert notify_calls["paid"] == []

    forbidden = client.post(f"/api/orders/{order['id']}/validate-manual")
    assert forbidden.status_code in (401, 403)

    ok = client.post(f"/api/orders/{order['id']}/validate-manual", headers=h)
    assert ok.status_code == 200, ok.text
    assert ok.json()["order"]["status"] == "paid"
    assert ok.json()["order"]["manual_payment"]["verified_by"].startswith("momo-admin-")
    assert len(ok.json()["tickets"]) >= 1
    assert notify_calls["paid"] == [order["id"]]

    again = client.post(f"/api/orders/{order['id']}/validate-manual", headers=h)
    assert again.status_code == 200
    assert again.json()["order"]["status"] == "paid"


def _sold(store, tt_id: str) -> int:
    row = store.fetchone("SELECT quantity_sold FROM ticket_types WHERE id = ?", (tt_id,))
    return int(row["quantity_sold"] if hasattr(row, "keys") else row[0])


def test_reject_releases_stock_and_notifies(client: TestClient, demo_store, notify_calls):
    store, _cfg, _services, _app = demo_store
    event_id, tt_id, h = _setup(client)
    first = _order(client, event_id, tt_id, "f@example.com", reference="REJECTME01").json()["order"]
    _order(client, event_id, tt_id, "g@example.com", reference="KEEPME00001")
    assert _sold(store, tt_id) == 2

    # stock exhausted: clean 409 sold_out (used to be a 500 KeyError)
    sold_out = _order(client, event_id, tt_id, "z@example.com", reference="NOSTOCK0000")
    assert sold_out.status_code == 409, sold_out.text
    assert sold_out.json()["error"]["code"] == "sold_out"

    no_reason = client.post(f"/api/orders/{first['id']}/reject-manual", json={"reason": " "}, headers=h)
    assert no_reason.status_code == 400

    rej = client.post(
        f"/api/orders/{first['id']}/reject-manual",
        json={"reason": "Référence introuvable"},
        headers=h,
    )
    assert rej.status_code == 200, rej.text
    assert rej.json()["order"]["status"] == "failed"
    assert rej.json()["order"]["manual_payment"]["rejection_reason"] == "Référence introuvable"
    assert notify_calls["rejected"] == [first["id"]]
    assert notify_calls["paid"] == []

    # stock released: a new buyer can now declare
    assert _sold(store, tt_id) == 1
    retry = _order(client, event_id, tt_id, "h@example.com", reference="NOSTOCK0001")
    assert retry.status_code == 201, retry.text

    again = client.post(
        f"/api/orders/{first['id']}/reject-manual", json={"reason": "x"}, headers=h
    )
    assert again.status_code == 409


def test_cleanup_spares_manual_pending_orders(client: TestClient, demo_store):
    store, _cfg, _services, _app = demo_store
    event_id, tt_id, _h = _setup(client)
    order = _order(client, event_id, tt_id, "i@example.com", reference="CLEANUP0001").json()["order"]
    old = time_to_text(datetime.now(timezone.utc) - timedelta(hours=5))
    store.execute("UPDATE orders SET created_at = ? WHERE id = ?", (old, order["id"]))
    assert pending_cleanup.release_stale_pending_orders(store) == 0
    row = store.fetchone("SELECT status FROM orders WHERE id = ?", (order["id"],))
    assert (row["status"] if hasattr(row, "keys") else row[0]) == "pending"
