"""Routes restantes (images, payouts, org bank, delete image)."""

from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse

from auth import rbac
from http_layer.deps import AppState, require_user
from http_layer.errors import json_error
from store import NotFoundError, images as images_repo
from store import org_bank, orgs as orgs_repo
from store import payouts as payouts_repo
from store.store import new_ulid

router = APIRouter(tags=["extras"])
images_router = APIRouter(tags=["images"])

MAX_UPLOAD = 8 * 1024 * 1024
BUILTIN_BANKS = [
    {"code": "manual", "name": "Manual / other"},
]


def _media_path(state: AppState, image_id: str, fmt: str) -> str:
    """Internal: media path."""
    ext = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}.get(fmt, f".{fmt}")
    return os.path.join(state.config.media_dir, f"{image_id}{ext}")


@router.post("/events/{event_id}/images")
async def upload_image(
    event_id: str,
    file: UploadFile = File(...),
    state: AppState = Depends(require_user),
):
    """Upload image."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this event's org")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        return json_error(400, "invalid_request", "file exceeds the 8MB maximum upload size")
    fmt = "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        fmt = "png"
    elif len(data) >= 12 and data[8:12] == b"WEBP":
        fmt = "webp"
    elif not (len(data) >= 2 and data[0] == 0xFF and data[1] == 0xD8):
        return json_error(400, "invalid_request", "unsupported image format: only png, jpeg, and webp are accepted")
    os.makedirs(state.config.media_dir, mode=0o700, exist_ok=True)
    img_id = new_ulid()
    path = _media_path(state, img_id, fmt)
    with open(path, "wb") as f:
        f.write(data)
    now = datetime.now(timezone.utc)
    uid = state.current_user.id if state.current_user else None
    images_repo.create_image(
        state.store,
        images_repo.Image(
            id=img_id,
            event_id=event_id,
            format=fmt,
            width=0,
            height=0,
            size_bytes=len(data),
            uploaded_by=uid,
            created_at=now,
        ),
    )
    return {
        "image": {
            "id": img_id,
            "url": f"/media/{img_id}",
            "width": 0,
            "height": 0,
        }
    }


@router.get("/events/{event_id}/payouts")
def event_payouts(event_id: str, state: AppState = Depends(require_user)):
    """Event payouts."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this event's org")
    rows = payouts_repo.list_payouts_for_event(state.store, event_id)
    return {
        "payouts": [
            {
                "id": p.id,
                "event_id": p.event_id,
                "amount_minor": p.amount_minor,
                "currency": p.currency,
                "status": p.status,
                "created_at": p.created_at.isoformat().replace("+00:00", "Z"),
            }
            for p in rows
        ]
    }


@router.patch("/orgs/{org_id}/members/{user_id}")
def patch_member(org_id: str, user_id: str, body: dict, state: AppState = Depends(require_user)):
    """Patch member role (admin+); rank rules match org invites."""
    actor_id = state.current_user.id
    if not rbac.can_manage_org(state.store, actor_id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    new_role = (body.get("role") or "").strip()
    if new_role not in ("owner", "admin", "scanner"):
        return json_error(400, "invalid_request", "invalid role")
    try:
        actor_role = orgs_repo.get_org_member_role(state.store, org_id, actor_id)
        target_role = orgs_repo.get_org_member_role(state.store, org_id, user_id)
    except NotFoundError:
        return json_error(404, "not_found", "member not found")
    if rbac._RANK.get(target_role, 0) > rbac._RANK.get(actor_role, 0):
        return json_error(403, "forbidden", "you cannot modify a member with a higher role than yours")
    if rbac._RANK.get(new_role, 0) > rbac._RANK.get(actor_role, 0):
        return json_error(403, "forbidden", "you cannot assign a role higher than your own")
    if new_role == rbac.ROLE_OWNER and actor_role != rbac.ROLE_OWNER:
        return json_error(403, "forbidden", "only an owner can assign the owner role")
    if target_role == rbac.ROLE_OWNER and new_role != rbac.ROLE_OWNER:
        owners = [m for m in orgs_repo.list_org_members(state.store, org_id) if m.role == rbac.ROLE_OWNER]
        if len(owners) <= 1 and owners[0].user_id == user_id:
            return json_error(409, "conflict", "cannot remove the last owner from the organization")
    state.store.execute(
        "UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?",
        (new_role, org_id, user_id),
    )
    return {"ok": True}


@router.delete("/orgs/{org_id}/members/{user_id}", status_code=204)
def delete_member(org_id: str, user_id: str, state: AppState = Depends(require_user)):
    """Remove a member from the org (admin+); rank rules match PATCH member role."""
    from fastapi import Response

    actor_id = state.current_user.id
    if not rbac.can_manage_org(state.store, actor_id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    if actor_id == user_id:
        return json_error(403, "forbidden", "you cannot remove yourself from the organization")
    try:
        actor_role = orgs_repo.get_org_member_role(state.store, org_id, actor_id)
        target_role = orgs_repo.get_org_member_role(state.store, org_id, user_id)
    except NotFoundError:
        return json_error(404, "not_found", "member not found")
    if rbac._RANK.get(target_role, 0) > rbac._RANK.get(actor_role, 0):
        return json_error(403, "forbidden", "you cannot remove a member with a higher role than yours")
    if target_role == rbac.ROLE_OWNER:
        owners = [m for m in orgs_repo.list_org_members(state.store, org_id) if m.role == rbac.ROLE_OWNER]
        if len(owners) <= 1:
            return json_error(409, "conflict", "cannot remove the last owner from the organization")
    state.store.execute(
        "DELETE FROM org_members WHERE org_id = ? AND user_id = ?",
        (org_id, user_id),
    )
    return Response(status_code=204)


@router.get("/orgs/{org_id}/bank-account")
def get_bank(org_id: str, state: AppState = Depends(require_user)):
    """Get bank."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    try:
        acct = org_bank.get_bank_account(state.store, org_id)
    except NotFoundError:
        return json_error(404, "not_found", "no bank account on file")
    return {
        "bank_account": {
            "bank_code": acct.bank_code,
            "account_number": acct.account_number,
            "account_name": acct.account_name,
        }
    }


@router.put("/orgs/{org_id}/bank-account")
def put_bank(org_id: str, body: dict, state: AppState = Depends(require_user)):
    """Put bank."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_OWNER):
        return json_error(403, "forbidden", "you are not the owner of this org")
    code = (body.get("bank_code") or "").strip()
    num = (body.get("account_number") or "").strip()
    name = (body.get("account_name") or "").strip()
    if not code or not num or not name:
        return json_error(400, "invalid_request", "bank_code, account_number and account_name are required")
    org_bank.set_bank_account(
        state.store,
        org_bank.BankAccount(org_id=org_id, bank_code=code, account_number=num, account_name=name),
    )
    return {"ok": True}


@router.delete("/invites/{invite_id}", status_code=204)
def delete_invite(invite_id: str, state: AppState = Depends(require_user)):
    """Delete invite."""
    row = state.store.fetchone("SELECT org_id FROM org_invites WHERE id = ?", (invite_id,))
    if row is None:
        return json_error(404, "not_found", "invite not found")
    org_id = row["org_id"] if hasattr(row, "keys") else row[0]
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    state.store.execute("DELETE FROM org_invites WHERE id = ?", (invite_id,))
    from fastapi import Response

    return Response(status_code=204)


@router.get("/banks")
def list_banks(_state: AppState = Depends(require_user)):
    """List banks."""
    return {"banks": BUILTIN_BANKS}


@images_router.delete("/images/{image_id}", status_code=204)
def delete_image_route(image_id: str, state: AppState = Depends(require_user)):
    """Delete image route."""
    try:
        event_id = images_repo.image_event_id(state.store, image_id)
    except NotFoundError:
        return json_error(404, "not_found", "image not found")
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this event's org")
    try:
        img = images_repo.get_image(state.store, image_id)
    except NotFoundError:
        return json_error(404, "not_found", "image not found")
    path = _media_path(state, img.id, img.format)
    images_repo.delete_image(state.store, image_id)
    try:
        os.remove(path)
    except OSError:
        pass
    from fastapi import Response

    return Response(status_code=204)
