"""Org member role changes (admin vs owner rules)."""

from fastapi.testclient import TestClient


def _signup(client: TestClient, email: str, name: str) -> dict:
    r = client.post(
        "/api/auth/signup",
        json={"email": email, "password": "longpassword1", "name": name},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _org(client: TestClient, headers: dict, slug: str) -> str:
    r = client.post("/api/orgs", json={"name": slug, "slug": slug}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["org"]["id"]


def test_admin_can_change_scanner_role(client: TestClient, demo_store):
    owner_h = _signup(client, "owner-patch@example.com", "Owner")
    org_id = _org(client, owner_h, "patch-org-1")

    # Invite admin (creates account with default password)
    inv = client.post(
        f"/api/orgs/{org_id}/invites",
        json={"email": "admin-patch@example.com", "role": "admin"},
        headers=owner_h,
    )
    assert inv.status_code == 201, inv.text
    client.cookies.clear()
    admin_login = client.post(
        "/api/auth/login",
        json={"email": "admin-patch@example.com", "password": "Tfestiv2026"},
    )
    assert admin_login.status_code == 200, admin_login.text
    admin_h = {"Authorization": f"Bearer {admin_login.json()['token']}"}

    # Invite scanner
    inv2 = client.post(
        f"/api/orgs/{org_id}/invites",
        json={"email": "scan-patch@example.com", "role": "scanner"},
        headers=owner_h,
    )
    assert inv2.status_code == 201, inv2.text
    client.cookies.clear()
    scan_login = client.post(
        "/api/auth/login",
        json={"email": "scan-patch@example.com", "password": "Tfestiv2026"},
    )
    assert scan_login.status_code == 200, scan_login.text
    scan_user_id = scan_login.json()["user"]["id"]

    patch = client.patch(
        f"/api/orgs/{org_id}/members/{scan_user_id}",
        json={"role": "admin"},
        headers=admin_h,
    )
    assert patch.status_code == 200, patch.text


def test_admin_cannot_promote_to_owner(client: TestClient, demo_store):
    owner_h = _signup(client, "owner2-patch@example.com", "Owner2")
    org_id = _org(client, owner_h, "patch-org-2")

    inv = client.post(
        f"/api/orgs/{org_id}/invites",
        json={"email": "admin2-patch@example.com", "role": "admin"},
        headers=owner_h,
    )
    assert inv.status_code == 201
    client.cookies.clear()
    admin_login = client.post(
        "/api/auth/login",
        json={"email": "admin2-patch@example.com", "password": "Tfestiv2026"},
    )
    assert admin_login.status_code == 200
    admin_h = {"Authorization": f"Bearer {admin_login.json()['token']}"}

    members = client.get(f"/api/orgs/{org_id}/members", headers=admin_h)
    owner_id = next(m["user_id"] for m in members.json()["members"] if m["role"] == "owner")

    denied = client.patch(
        f"/api/orgs/{org_id}/members/{owner_id}",
        json={"role": "scanner"},
        headers=admin_h,
    )
    assert denied.status_code == 403, denied.text


def test_admin_can_remove_scanner(client: TestClient, demo_store):
    owner_h = _signup(client, "owner-rm@example.com", "OwnerRm")
    org_id = _org(client, owner_h, "rm-org-1")

    assert (
        client.post(
            f"/api/orgs/{org_id}/invites",
            json={"email": "admin-rm@example.com", "role": "admin"},
            headers=owner_h,
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/orgs/{org_id}/invites",
            json={"email": "scan-rm@example.com", "role": "scanner"},
            headers=owner_h,
        ).status_code
        == 201
    )

    members_before = client.get(f"/api/orgs/{org_id}/members", headers=owner_h)
    scan_id = next(
        m["user_id"] for m in members_before.json()["members"] if m["email"] == "scan-rm@example.com"
    )

    removed = client.delete(f"/api/orgs/{org_id}/members/{scan_id}", headers=owner_h)
    assert removed.status_code == 204, removed.text

    members = client.get(f"/api/orgs/{org_id}/members", headers=owner_h)
    emails = [m["email"] for m in members.json()["members"]]
    assert "scan-rm@example.com" not in emails
