"""Integration tests for visitor ticket purchase and payment."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from bootstrap import build_payment_registry, build_services
from config import load_config
from http_layer.app import create_app
from orders.service import CreateOrderInput, OrderItemInput
from payments.remote import RemotePaymentProvider
from payments.registry import Registry
from payments.manual import ManualProvider
from conftest import TEST_DATABASE_URL, seed_published_event


def test_remote_purchase_webhook_settle(demo_store, tmp_path):
    """Test remote purchase webhook settle."""
    store, cfg, _services, _app = demo_store
    fx = seed_published_event(store)
    charges: dict[str, dict] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        """Handler."""
        if request.method == "POST" and request.url.path == "/v1/charges":
            body = json.loads(request.content.decode())
            ref = body["order_id"]
            charges[ref] = {
                "reference": ref,
                "status": "pending",
                "redirect_url": "https://pay.test/checkout",
                "instructions": "",
            }
            return httpx.Response(201, json=charges[ref])
        if request.method == "GET" and request.url.path.startswith("/v1/charges/"):
            ref = request.url.path.rsplit("/", 1)[-1]
            data = charges.get(ref, {})
            paid = {
                **data,
                "status": "paid",
                "event_id": "pay-ms-evt-1",
                "amount_minor": body_amount_for(ref, store),
                "currency": "EUR",
                "paid_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            return httpx.Response(200, json=paid)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(base_url="https://pay.test", transport=transport)
    reg = Registry()
    reg.register(ManualProvider(store=store))
    reg.register(
        RemotePaymentProvider(
            base_url="https://pay.test",
            api_key="test-key",
            webhook_secret="whsec-test",
            provider_name="community-pay",
            client=client,
        )
    )
    cfg = load_config(database_url=TEST_DATABASE_URL, demo=True)
    cfg.payment_provider_name = "community-pay"
    from notify.notify import NotifyService
    from orders.service import OrdersService

    orders = OrdersService(store, reg, notify=NotifyService(store, cfg))
    from bootstrap import AppServices, _MemorySeenStore

    services = AppServices(
        payments=reg,
        orders=orders,
        notify=NotifyService(store, cfg),
        webhook_seen=_MemorySeenStore(),
    )
    app = create_app(store, cfg, services)
    tc = TestClient(app)

    create_body = {
        "event_id": fx["event_id"],
        "items": [{"ticket_type_id": fx["ticket_type_id"], "quantity": 2}],
        "buyer": {"email": "buyer@example.com", "name": "Buyer"},
        "provider": "community-pay",
    }
    resp = tc.post("/api/orders", json=create_body)
    assert resp.status_code == 201, resp.text
    order_id = resp.json()["order"]["id"]
    assert resp.json()["order"]["total_minor"] == 30000

    webhook_body = json.dumps(
        {
            "reference": order_id,
            "event_id": "pay-ms-evt-1",
            "status": "paid",
            "amount_minor": 30000,
            "currency": "EUR",
            "paid_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    ).encode()
    sig = "sha256=" + hmac.new(b"whsec-test", webhook_body, hashlib.sha256).hexdigest()
    wh = tc.post(
        "/api/payments/webhook/community-pay",
        content=webhook_body,
        headers={"Content-Type": "application/json", "X-Chantier3A-Payment-Signature": sig},
    )
    assert wh.status_code == 200, wh.text

    verify = tc.post(
        "/api/payments/verify",
        json={"reference": order_id, "email": "buyer@example.com"},
    )
    assert verify.status_code == 200, verify.text
    assert verify.json()["order"]["status"] == "paid"
    assert len(verify.json()["tickets"]) == 2


def body_amount_for(ref: str, store) -> int:
    """Body amount for."""
    from store import orders as orders_repo

    return orders_repo.get_order_by_id(store, ref).total_minor
