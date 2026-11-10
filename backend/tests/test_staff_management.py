from starlette.testclient import TestClient

def test_staff_management_and_password_lifecycle(client: TestClient, demo_store):
    # 1. Signup owner
    signup = client.post(
        "/api/auth/signup",
        json={"email": "owner@acme.com", "password": "InitialOwnerPassword1", "name": "Org Admin"},
    )
    assert signup.status_code == 200, signup.text
    owner_token = signup.json()["token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    # 2. Create organization
    org_res = client.post("/api/orgs", json={"name": "Acme Festival", "slug": "acme-fest"}, headers=owner_headers)
    assert org_res.status_code == 201, org_res.text
    org_id = org_res.json()["org"]["id"]

    # 3. Direct staff creation: Admin creates scanner agent
    staff_res = client.post(
        f"/api/orgs/{org_id}/staff",
        json={
            "email": "scanner.bob@acme.com",
            "name": "Bob Scanner",
            "password": "TemporaryPassword123",
            "role": "scanner",
        },
        headers=owner_headers,
    )
    assert staff_res.status_code == 200, staff_res.text
    data = staff_res.json()
    assert data["user"]["email"] == "scanner.bob@acme.com"
    assert data["user"]["role"] == "scanner"
    bob_id = data["user"]["id"]

    # 4. Scanner logs in with temporary password
    client.cookies.clear()
    bob_login = client.post(
        "/api/auth/login",
        json={"email": "scanner.bob@acme.com", "password": "TemporaryPassword123"},
    )
    assert bob_login.status_code == 200, bob_login.text
    bob_token = bob_login.json()["token"]
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    # 5. Scanner changes their own password via /api/auth/change-password
    change_res = client.post(
        "/api/auth/change-password",
        json={
            "current_password": "TemporaryPassword123",
            "new_password": "BobNewSecretPassword456",
        },
        headers=bob_headers,
    )
    assert change_res.status_code == 200, change_res.text

    # 6. Verify old password no longer works
    client.cookies.clear()
    failed_login = client.post(
        "/api/auth/login",
        json={"email": "scanner.bob@acme.com", "password": "TemporaryPassword123"},
    )
    assert failed_login.status_code == 401

    # 7. Verify new password works
    success_login = client.post(
        "/api/auth/login",
        json={"email": "scanner.bob@acme.com", "password": "BobNewSecretPassword456"},
    )
    assert success_login.status_code == 200

    # 8. Admin resets staff password via /api/orgs/{org_id}/staff/{user_id}/reset-password
    reset_res = client.post(
        f"/api/orgs/{org_id}/staff/{bob_id}/reset-password",
        json={"new_password": "AdminResetPassword789"},
        headers=owner_headers,
    )
    assert reset_res.status_code == 200, reset_res.text

    # 9. Verify staff can login with reset password
    client.cookies.clear()
    reset_login = client.post(
        "/api/auth/login",
        json={"email": "scanner.bob@acme.com", "password": "AdminResetPassword789"},
    )
    assert reset_login.status_code == 200
