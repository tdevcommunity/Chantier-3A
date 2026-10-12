"""Velto provider: redirect checkout, HMAC webhooks, fail-closed verification."""

from __future__ import annotations

import hashlib
import hmac
import json

import httpx
import pytest

from payments import types as pt
from payments.velto import VeltoProvider

WEBHOOK_SECRET = "sk_sandbox_test"


class FakeVelto:
    def __init__(self) -> None:
        self.payments: dict[str, dict] = {}
        self.by_ref: dict[str, str] = {}
        self.last_create_body: dict | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"].startswith("Bearer sk_")
        path = request.url.path.rstrip("/")
        if request.method == "POST" and path.endswith("/payments"):
            body = json.loads(request.content)
            self.last_create_body = body
            tid = f"tnx_{len(self.payments) + 1}"
            txn = {
                "id": tid,
                "amount": body["amount"],
                "currency": body.get("currency", "XOF"),
                "status": "PENDING",
                "external_reference": body["external_reference"],
                "checkout_url": f"https://checkout.test/pay/{tid}",
            }
            self.payments[tid] = txn
            self.by_ref[body["external_reference"]] = tid
            return httpx.Response(200, json={"status": True, "data": txn})
        if request.method == "GET" and "/payments/" in path and not path.endswith("/payments"):
            tid = path.rsplit("/", 1)[-1]
            txn = self.payments.get(tid)
            return httpx.Response(200, json={"status": True, "data": txn}) if txn else httpx.Response(404)
        if request.method == "GET" and path.endswith("/payments"):
            return httpx.Response(
                200,
                json={
                    "status": True,
                    "data": list(self.payments.values()),
                    "meta": {"totalPages": 1},
                },
            )
        return httpx.Response(404)


def _fake_client(fake: FakeVelto) -> httpx.Client:
    return httpx.Client(base_url="https://velto-gate.test/v1", transport=httpx.MockTransport(fake.handler))


def _provider(fake: FakeVelto, *, secret_key: str = WEBHOOK_SECRET) -> VeltoProvider:
    return VeltoProvider(secret_key=secret_key, client=_fake_client(fake))


def _signed(body: bytes, secret: str = WEBHOOK_SECRET) -> dict[str, str]:
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return {"X-Velto-Signature": sig}


def _order(reference: str = "ORDER1") -> pt.Order:
    return pt.Order(
        reference=reference,
        event_id="evt",
        buyer_email="a@b.co",
        buyer_name="Ada Lovelace",
        amount_minor=15000,
        currency="XOF",
        callback_url="https://shop.test/?velto_return=1&order=ORDER1",
        metadata={"phone": "22990000000"},
    )


def test_begin_returns_checkout_redirect():
    fake = FakeVelto()
    charge = _provider(fake).begin(_order())
    assert charge.redirect_url.startswith("https://checkout.test/")
    assert charge.client_token == "tnx_1"


def test_begin_does_not_send_phone_in_customer():
    fake = FakeVelto()
    _provider(fake).begin(_order())
    assert fake.last_create_body is not None
    assert fake.last_create_body["customer"]["email"] == "a@b.co"
    assert "phone" not in fake.last_create_body["customer"]
    assert "countries" not in fake.last_create_body


def test_verify_pending_until_approved():
    fake = FakeVelto()
    provider = _provider(fake)
    provider.begin(_order())
    assert provider.verify("ORDER1").status == pt.Status.PENDING
    fake.payments["tnx_1"]["status"] = "APPROVED"
    assert provider.verify("ORDER1").status == pt.Status.PAID


def test_webhook_verifies_hmac_and_refetches():
    fake = FakeVelto()
    provider = _provider(fake)
    provider.begin(_order())
    fake.payments["tnx_1"]["status"] = "APPROVED"
    body = json.dumps(
        {
            "event": "payment.success",
            "transaction_id": "tnx_1",
            "external_reference": "ORDER1",
            "amount": 15000,
            "currency": "XOF",
            "status": "APPROVED",
        }
    ).encode()
    result = provider.webhook(body, _signed(body))
    assert result.status == pt.Status.PAID
    assert result.reference == "ORDER1"


def test_verify_for_order_uses_stored_txn_id():
    fake = FakeVelto()
    provider = _provider(fake)
    provider.begin(_order("ORDER_A"))
    fake.payments["tnx_1"]["status"] = "APPROVED"
    provider.begin(_order("ORDER_B"))
    assert provider.verify_for_order("ORDER_B", "tnx_1").status == pt.Status.PENDING
    assert provider.verify_for_order("ORDER_A", "tnx_1").status == pt.Status.PAID


def test_webhook_success_ignored_when_transaction_still_pending():
    fake = FakeVelto()
    provider = _provider(fake)
    provider.begin(_order("ORD_PENDING"))
    body = json.dumps(
        {
            "event": "payment.success",
            "transaction_id": "tnx_1",
            "external_reference": "ORD_PENDING",
            "amount": 15000,
            "currency": "XOF",
        }
    ).encode()
    with pytest.raises(ValueError, match="not approved"):
        provider.webhook(body, _signed(body))


def test_webhook_rejects_bad_signature():
    fake = FakeVelto()
    provider = _provider(fake)
    body = b'{"event":"payment.success"}'
    with pytest.raises(ValueError, match="invalid webhook signature"):
        provider.webhook(body, {"X-Velto-Signature": "deadbeef"})
