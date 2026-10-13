"""FedaPay provider: server-side transaction, signed webhooks, fail-closed verification."""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from bootstrap import AppServices, _MemorySeenStore
from config import load_config
from http_layer.app import create_app
from notify.notify import NotifyService
from orders.service import CreateOrderInput, OrderItemInput, OrdersError, OrdersService
from payments import types as pt
from payments.fedapay import FedapayProvider
from payments.manual import ManualProvider
from payments.registry import Registry
from conftest import TEST_DATABASE_URL, seed_published_event

WEBHOOK_SECRET = "wh_sandbox_test"


class FakeFedapay:
    """Minimal in-memory FedaPay API keyed by merchant_reference."""

    def __init__(self) -> None:
        self.txns: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.fail_create = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, request.url.path))
        assert request.headers["authorization"] == "Bearer sk_test"
        path = request.url.path
        if request.method == "POST" and path == "/transactions":
            if self.fail_create:
                return httpx.Response(503)
            body = json.loads(request.content)
            txn = {
                "id": 1000 + len(self.txns),
                "status": "pending",
                "amount": body["amount"],
                "currency_id": 1,  # the real API returns an id, not an object
                "merchant_reference": body["merchant_reference"],
            }
            self.txns[body["merchant_reference"]] = txn
            return httpx.Response(200, json={"v1/transaction": txn})
        if request.method == "GET" and path == "/currencies":
            return httpx.Response(200, json={"v1/currencies": [{"id": 1, "iso": "XOF"}]})
        if request.method == "GET" and path.startswith("/transactions/merchant/"):
            txn = self.txns.get(path.rsplit("/", 1)[-1])
            return httpx.Response(200, json={"v1/transaction": txn}) if txn else httpx.Response(404)
        if request.method == "GET" and path.startswith("/transactions/"):
            tid = int(path.rsplit("/", 1)[-1])
            for txn in self.txns.values():
                if txn["id"] == tid:
                    return httpx.Response(200, json={"v1/transaction": txn})
        return httpx.Response(404)

    def approve(self, reference: str, **overrides) -> dict:
        txn = self.txns[reference]
        txn.update(status="approved", approved_at="2026-09-30T10:00:00Z", **overrides)
        return txn


def _provider(fake: FakeFedapay) -> FedapayProvider:
    client = httpx.Client(base_url="https://sandbox-api.test", transport=httpx.MockTransport(fake.handler))
    return FedapayProvider(secret_key="sk_test", webhook_secret=WEBHOOK_SECRET, client=client)


def _signed(body: bytes, *, ts: int | None = None, secret: str = WEBHOOK_SECRET) -> dict[str, str]:
    ts = int(time.time()) if ts is None else ts
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return {"X-FEDAPAY-SIGNATURE": f"t={ts},s={sig}"}


def _event(txn: dict, name: str = "transaction.approved") -> bytes:
    return json.dumps({"id": "evt_1", "name": name, "object": "event", "entity": {"id": txn["id"]}}).encode()


def _order(reference: str = "ORDER1", currency: str = "XOF", amount: int = 15000) -> pt.Order:
    return pt.Order(
        reference=reference, event_id="evt", buyer_email="a@b.co", buyer_name="Ada Lovelace",
        amount_minor=amount, currency=currency,
    )


def test_begin_creates_server_side_transaction_and_returns_id():
    fake = FakeFedapay()
    charge = _provider(fake).begin(_order())
    assert charge.client_token == "1000"
    assert charge.redirect_url == ""
    assert fake.txns["ORDER1"]["amount"] == 15000


def test_begin_rejects_non_xof():
    with pytest.raises(ValueError):
        _provider(FakeFedapay()).begin(_order(currency="EUR"))


def test_verify_paid_reconciles_and_pending_is_not_paid():
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    want = pt.OrderRef(id="ORDER1", amount_minor=15000, currency="XOF")
    with pytest.raises(Exception) as exc:
        pt.reconcile(provider.verify("ORDER1"), want)
    assert exc.value is pt.ErrNotPaid
    fake.approve("ORDER1")
    pt.reconcile(provider.verify("ORDER1"), want)


def test_verify_unknown_currency_fails_closed():
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    fake.approve("ORDER1", currency_id=99)
    with pytest.raises(Exception) as exc:
        pt.reconcile(provider.verify("ORDER1"), pt.OrderRef("ORDER1", 15000, "XOF"))
    assert exc.value is pt.ErrCurrencyMismatch


def test_verify_amount_mismatch_fails_closed():
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    fake.approve("ORDER1", amount=100)
    with pytest.raises(Exception) as exc:
        pt.reconcile(provider.verify("ORDER1"), pt.OrderRef("ORDER1", 15000, "XOF"))
    assert exc.value is pt.ErrAmountMismatch


def test_verify_amount_with_customer_fees_accepts_overpay():
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    fake.approve("ORDER1", amount=15208)
    pt.reconcile(provider.verify("ORDER1"), pt.OrderRef("ORDER1", 15000, "XOF"))


def test_webhook_valid_refetches_transaction_from_api():
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    txn = fake.approve("ORDER1")
    result = provider.webhook(_event(txn), _signed(_event(txn)))
    assert result.status == pt.Status.PAID and result.reference == "ORDER1"
    assert result.event_id == "transaction.approved:1000"
    assert ("GET", "/transactions/1000") in fake.calls


def test_webhook_payload_cannot_forge_payment():
    """A signed event for a still-pending transaction must not settle."""
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    txn = fake.txns["ORDER1"]
    result = provider.webhook(_event(txn), _signed(_event(txn)))
    assert result.status == pt.Status.PENDING


@pytest.mark.parametrize("bad", ["no_header", "wrong_secret", "stale", "tampered"])
def test_webhook_rejects_bad_signature(bad):
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    body = _event(fake.approve("ORDER1"))
    headers = {
        "no_header": {},
        "wrong_secret": _signed(body, secret="other"),
        "stale": _signed(body, ts=int(time.time()) - 3600),
        "tampered": _signed(body + b" "),
    }[bad]
    with pytest.raises(ValueError):
        provider.webhook(body, headers)


def test_webhook_other_events_are_unhandled():
    fake = FakeFedapay()
    provider = _provider(fake)
    provider.begin(_order())
    body = _event(fake.txns["ORDER1"], name="transaction.created")
    with pytest.raises(Exception) as exc:
        provider.webhook(body, _signed(body))
    assert exc.value is pt.ErrUnhandledEvent


# --- integration with orders + HTTP (needs PostgreSQL like the other purchase tests) ---


def _services(store, fake: FakeFedapay):
    cfg = load_config(database_url=TEST_DATABASE_URL, demo=True)
    reg = Registry()
    reg.register(ManualProvider(store=store))
    reg.register(_provider(fake))
    notify = NotifyService(store, cfg)
    services = AppServices(
        payments=reg, orders=OrdersService(store, reg, notify=notify),
        notify=notify, webhook_seen=_MemorySeenStore(),
    )
    return cfg, services


def _xof_event(store) -> dict:
    fx = seed_published_event(store)
    store.execute("UPDATE events SET currency = 'XOF' WHERE id = ?", (fx["event_id"],))
    return fx


def _create(client: TestClient, fx: dict) -> dict:
    resp = client.post(
        "/api/orders",
        json={
            "event_id": fx["event_id"],
            "items": [{"ticket_type_id": fx["ticket_type_id"], "quantity": 1}],
            "buyer": {"email": "buyer@example.com", "first_name": "Ada", "last_name": "L", "wish": "x"},
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_full_flow_widget_verify_settles_once(demo_store):
    store, _cfg, _s, _app = demo_store
    fx = _xof_event(store)
    fake = FakeFedapay()
    cfg, services = _services(store, fake)
    client = TestClient(create_app(store, cfg, services))

    created = _create(client, fx)
    order_id = created["order"]["id"]
    assert created["payment"]["provider"] == "fedapay"
    assert created["payment"]["client_token"]
    assert created["payment"]["redirect_url"] == ""

    buyer = "buyer@example.com"
    pending = client.post(
        "/api/payments/verify",
        json={"reference": order_id, "email": buyer},
    )
    assert pending.status_code == 402  # widget closed / not paid yet: no ticket

    fake.approve(order_id)
    ok = client.post("/api/payments/verify", json={"reference": order_id, "email": buyer})
    assert ok.status_code == 200 and len(ok.json()["tickets"]) == 1
    assert "registration" not in ok.json()["order"]
    again = client.post("/api/payments/verify", json={"reference": order_id, "email": buyer})
    assert again.status_code == 200 and len(again.json()["tickets"]) == 1


def test_full_flow_webhook_settles_and_bad_signature_rejected(demo_store):
    store, _cfg, _s, _app = demo_store
    fx = _xof_event(store)
    fake = FakeFedapay()
    cfg, services = _services(store, fake)
    client = TestClient(create_app(store, cfg, services))
    order_id = _create(client, fx)["order"]["id"]
    body = _event(fake.approve(order_id))

    assert client.post("/api/payments/webhook/fedapay", content=body).status_code == 400
    ok = client.post("/api/payments/webhook/fedapay", content=body, headers=_signed(body))
    assert ok.status_code == 200
    assert services.orders.get(order_id).status == "paid"
    replay = client.post("/api/payments/webhook/fedapay", content=body, headers=_signed(body))
    assert replay.status_code == 200


def test_provider_outage_releases_stock(demo_store):
    store, _cfg, _s, _app = demo_store
    fx = _xof_event(store)
    fake = FakeFedapay()
    fake.fail_create = True
    _cfg2, services = _services(store, fake)
    inp = CreateOrderInput(
        event_id=fx["event_id"], buyer_email="b@example.com", buyer_first_name="A", buyer_last_name="B",
        wish="x", items=[OrderItemInput(fx["ticket_type_id"], 1)],
    )
    with pytest.raises(OrdersError):
        services.orders.create(inp)
    sold = store.fetchone("SELECT quantity_sold FROM ticket_types WHERE id = ?", (fx["ticket_type_id"],))
    assert sold["quantity_sold"] == 0
