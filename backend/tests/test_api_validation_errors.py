"""API must not leak Pydantic validation details to clients."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_orders_invalid_body_no_pydantic_detail(client: TestClient):
    r = client.post("/api/orders", json={"not": "an order"})
    assert r.status_code == 422
    body = r.json()
    assert "detail" not in body
    assert body["error"]["code"] == "invalid_request"
    assert "loc" not in str(body).lower()
