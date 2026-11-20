"""Web gate: lookup by serial suffix and admit without QR."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_scan_and_tickets_e2e import _paid_ticket_flow


def test_lookup_and_scan_by_serial_suffix(client: TestClient, demo_store):
    event_id, _ticket_id, _capability, serial, headers = _paid_ticket_flow(client, demo_store)
    suffix = serial.rsplit("-", 1)[-1]
    while len(suffix) > 1 and suffix.startswith("0"):
        suffix = suffix[1:]

    lookup = client.post(
        "/api/scan/lookup-serial",
        json={"event_id": event_id, "serial_suffix": suffix},
        headers=headers,
    )
    assert lookup.status_code == 200, lookup.text
    body = lookup.json()
    assert body.get("found") is True
    assert body["preview"]["serial"] == serial

    admit = client.post(
        "/api/scan/by-serial",
        json={"event_id": event_id, "serial": serial, "gate_id": "web-test"},
        headers=headers,
    )
    assert admit.status_code == 200, admit.text
    assert admit.json()["result"] == "admitted"

    again = client.post(
        "/api/scan/by-serial",
        json={"event_id": event_id, "serial": serial},
        headers=headers,
    )
    assert again.json()["result"] == "duplicate"