"""Staff invite e-mail (best-effort)."""

from fastapi.testclient import TestClient


def test_create_invite_returns_email_sent_flag(client: TestClient, demo_store, monkeypatch):
    sent = {"ok": False}

    def fake_send(config, ctx=None, **kwargs):
        sent["ok"] = True
        return True

    monkeypatch.setattr("notify.staff_invite_mail.send_staff_invite_email", fake_send)
    _store, cfg, _services, app = demo_store
    app.state.config.smtp_host = "smtp.example.com"
    app.state.config.smtp_from = "noreply@example.com"

    signup = client.post(
        "/api/auth/signup",
        json={"email": "owner-inv@example.com", "password": "longpassword1", "name": "Owner"},
    )
    assert signup.status_code == 200
    h = {"Authorization": f"Bearer {signup.json()['token']}"}
    org = client.post("/api/orgs", json={"name": "Inv Org", "slug": "inv-org-email"}, headers=h)
    org_id = org.json()["org"]["id"]
    inv = client.post(
        f"/api/orgs/{org_id}/invites",
        json={"email": "newstaff@example.com", "role": "scanner"},
        headers=h,
    )
    assert inv.status_code == 201, inv.text
    body = inv.json()
    assert body.get("email_sent") is True
    assert sent["ok"] is True
