"""Organization CRUD, members, and invite routes."""

from __future__ import annotations

import hashlib
import logging
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from auth import rbac
from auth import service as auth_svc
from config import scanner_login_url, staff_login_url
from http_layer.deps import AppState, require_user
from http_layer.errors import json_error
from money import currency as money
from store import NotFoundError, orgs as orgs_repo
from store.orgs import Org, SlugTakenError
from store.store import new_ulid
from store.timeutil import time_to_text

router = APIRouter(prefix="/orgs", tags=["orgs"])
invites_router = APIRouter(tags=["invites"])

VALID_ROLES = {"owner", "admin", "scanner"}
INVITE_TTL = timedelta(days=7)
log = logging.getLogger("chantier3a.orgs")


def _queue_staff_invite_email(
    config,
    *,
    org_name: str,
    role: str,
    email: str,
    account_created: bool,
) -> None:
    """Send staff access instructions in a background thread (best-effort)."""

    def run() -> None:
        from notify.staff_invite_email import StaffInviteEmailContext
        from notify.staff_invite_mail import send_staff_invite_email

        base = config.base_url.rstrip("/")
        mobile_scanner = role == "scanner"
        login_url = scanner_login_url(config) if mobile_scanner else staff_login_url(config)
        contact_url = f"{base}/contact" if base else None
        try:
            send_staff_invite_email(
                config,
                StaffInviteEmailContext(
                    org_name=org_name,
                    role=role,
                    login_url=login_url,
                    invited_email=email,
                    account_created=account_created,
                    default_password=auth_svc.DEFAULT_STAFF_PASSWORD if account_created else None,
                    contact_url=contact_url,
                    mobile_scanner=mobile_scanner,
                ),
            )
        except Exception as err:
            log.error("staff_invite: failed to send to %s: %s", email, err)

    threading.Thread(target=run, daemon=True).start()


@router.post("")
def create_org(body: dict, state: AppState = Depends(require_user)):
    """Create org."""
    if state.current_user is None:
        return json_error(401, "unauthorized", "authentication required")
    if state.config.community_mode:
        try:
            if orgs_repo.count_orgs(state.store) >= 1:
                return json_error(403, "forbidden", "organisation creation is disabled in community mode")
        except Exception:
            pass
    name = (body.get("name") or "").strip()
    if not name:
        return json_error(400, "invalid_request", "name is required")
    slug = (body.get("slug") or "").strip() or orgs_repo.slugify(name)
    if len(slug) < 2:
        return json_error(400, "invalid_request", "slug is too short")
    default_currency = (body.get("default_currency") or "").strip()
    try:
        if default_currency:
            default_currency = money.normalize(default_currency)
    except money.CurrencyError as err:
        return json_error(400, "invalid_request", str(err))
    now = datetime.now(timezone.utc)
    org = Org(
        id=new_ulid(),
        name=name,
        slug=slug,
        default_currency=default_currency or "USD",
        created_at=now,
    )
    try:
        orgs_repo.create_org_with_owner(state.store, org, state.current_user.id)
    except SlugTakenError:
        return json_error(409, "conflict", "an organisation with that URL name already exists — pick another")
    except money.CurrencyError as err:
        return json_error(400, "invalid_request", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return Response(
        content=_json(
            {
                "org": {
                    "id": org.id,
                    "name": org.name,
                    "slug": org.slug,
                    "default_currency": org.default_currency,
                    "role": rbac.ROLE_OWNER,
                }
            }
        ),
        media_type="application/json",
        status_code=201,
    )


@router.get("/{org_id}/events")
def list_org_events(org_id: str, state: AppState = Depends(require_user)):
    """List org events."""
    from events import service as events_svc

    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not a member of this org")
    events = events_svc.list_by_org(state.store, org_id)
    return {"events": events}


@router.get("/{org_id}/members")
def list_members(org_id: str, state: AppState = Depends(require_user)):
    """List members."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    members = orgs_repo.list_org_members(state.store, org_id)
    return {
        "members": [
            {"user_id": m.user_id, "name": m.name, "email": m.email, "role": m.role} for m in members
        ]
    }


@router.get("/{org_id}/invites")
def list_invites(org_id: str, state: AppState = Depends(require_user)):
    """List invites."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    invites = orgs_repo.list_pending_org_invites(state.store, org_id)
    return {
        "invites": [
            {
                "id": i.id,
                "email": i.email,
                "role": i.role,
                "expires_at": time_to_text(i.expires_at),
                "created_at": time_to_text(i.created_at),
            }
            for i in invites
        ]
    }


@router.post("/{org_id}/invites")
def create_invite(org_id: str, body: dict, state: AppState = Depends(require_user)):
    """Create invite."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    email = (body.get("email") or "").strip().lower()
    role = (body.get("role") or "").strip()
    if not email or role not in VALID_ROLES:
        return json_error(400, "invalid_request", "email and a valid role (owner, admin, scanner) are required")
    try:
        inviter_role = orgs_repo.get_org_member_role(state.store, org_id, state.current_user.id)
    except NotFoundError:
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    if rbac._RANK.get(role, 0) > rbac._RANK.get(inviter_role, 0):
        return json_error(403, "forbidden", "you cannot invite someone at a role higher than your own")
    import base64
    import secrets

    raw = secrets.token_bytes(32)
    token = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    now = datetime.now(timezone.utc)
    inv = orgs_repo.OrgInvite(
        id=new_ulid(),
        org_id=org_id,
        email=email,
        role=role,
        token_hash=token_hash,
        expires_at=now + INVITE_TTL,
        created_at=now,
    )
    orgs_repo.create_org_invite(state.store, inv)
    try:
        user, account_created = auth_svc.provision_invited_staff_user(state.store, email)
    except auth_svc.InvalidEmail:
        return json_error(400, "invalid_request", "invalid email address")
    except auth_svc.WeakPassword:
        return json_error(500, "internal_error", "default staff password is misconfigured")
    try:
        orgs_repo.get_org_member_role(state.store, org_id, user.id)
    except NotFoundError:
        orgs_repo.add_org_member(state.store, org_id, user.id, role, now)
    else:
        return json_error(409, "conflict", "this person is already a member of the organisation")
    orgs_repo.mark_invite_accepted(state.store, inv.id, now)
    try:
        org = orgs_repo.get_org_by_id(state.store, org_id)
        org_name = org.name
    except NotFoundError:
        org_name = "TDEV Festival"
    email_sent = bool(state.config.smtp_host and state.config.smtp_from)
    _queue_staff_invite_email(
        state.config,
        org_name=org_name,
        role=role,
        email=email,
        account_created=account_created,
    )
    payload: dict = {
        "invite_id": inv.id,
        "token": token,
        "expires_at": time_to_text(inv.expires_at),
        "account_created": account_created,
        "email_sent": email_sent,
    }
    if account_created:
        payload["default_password"] = auth_svc.DEFAULT_STAFF_PASSWORD
    return Response(
        content=_json(payload),
        media_type="application/json",
        status_code=201,
    )


@invites_router.post("/invites/accept")
def accept_invite(body: dict, state: AppState = Depends(require_user)):
    """Accept invite."""
    token = (body.get("token") or "").strip()
    if not token:
        return json_error(400, "invalid_request", "token is required")
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    try:
        inv = orgs_repo.get_org_invite_by_token_hash(state.store, token_hash)
    except NotFoundError:
        return json_error(400, "invalid_request", "invite is invalid, expired, or already used")
    now = datetime.now(timezone.utc)
    if inv.accepted_at is not None or inv.expires_at <= now:
        return json_error(400, "invalid_request", "invite is invalid, expired, or already used")
    if state.current_user.email.lower() != inv.email.lower():
        return json_error(403, "forbidden", "this invite was issued to a different email address")
    try:
        orgs_repo.add_org_member(state.store, inv.org_id, state.current_user.id, inv.role, now)
        orgs_repo.mark_invite_accepted(state.store, inv.id, now)
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"org_id": inv.org_id, "role": inv.role}


def _json(obj: dict) -> str:
    """Internal: json."""
    import json

    return json.dumps(obj)


class CreateStaffBody(BaseModel):
    email: str = ""
    name: str = ""
    password: str = ""
    role: str = "scanner"


class ResetStaffPasswordBody(BaseModel):
    new_password: str = ""


@router.post("/{org_id}/staff")
def create_or_update_staff(
    org_id: str,
    body: CreateStaffBody,
    state: AppState = Depends(require_user),
):
    """Direct creation or update of an operational staff account by an admin/owner."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "Droits administrateur requis sur cette organisation.")

    email = (body.email or "").strip().lower()
    role = (body.role or "scanner").strip().lower()
    name = (body.name or "").strip() or email.split("@")[0]
    password = (body.password or "").strip()

    if not email:
        return json_error(400, "invalid_request", "L'adresse e-mail est requise.")
    if role not in ("scanner", "admin"):
        return json_error(400, "invalid_request", "Rôle invalide (scanner ou admin).")
    if len(password) < auth_svc.MIN_PASSWORD_LENGTH:
        return json_error(
            400,
            "invalid_request",
            f"Le mot de passe doit comporter au moins {auth_svc.MIN_PASSWORD_LENGTH} caractères.",
        )

    from auth.email_canonical import canonical_email
    try:
        norm = canonical_email(email)
    except Exception:
        norm = email

    from auth.password import hash_password
    from store import users as user_store
    now = datetime.now(timezone.utc)
    ph = hash_password(password)

    try:
        existing = user_store.get_user_by_email(state.store, norm)
        user_store.update_password_hash(state.store, existing.id, ph)
        user_id = existing.id
        user_name = existing.name or name
    except NotFoundError:
        user = user_store.create_user(
            state.store,
            user_store.UserPartial(email=norm, password_hash=ph, name=name),
        )
        user_id = user.id
        user_name = user.name

    try:
        orgs_repo.get_org_member_role(state.store, org_id, user_id)
        state.store.execute(
            "UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?",
            (role, org_id, user_id),
        )
    except NotFoundError:
        orgs_repo.add_org_member(state.store, org_id, user_id, role, now)

    return {
        "ok": True,
        "user": {
            "id": user_id,
            "email": norm,
            "name": user_name,
            "role": role,
        },
    }


@router.post("/{org_id}/staff/{user_id}/reset-password")
def reset_staff_password(
    org_id: str,
    user_id: str,
    body: ResetStaffPasswordBody,
    state: AppState = Depends(require_user),
):
    """Admin resets password for a staff member."""
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "Droits administrateur requis.")

    new_pw = (body.new_password or "").strip()
    if len(new_pw) < auth_svc.MIN_PASSWORD_LENGTH:
        return json_error(
            400,
            "invalid_request",
            f"Le mot de passe doit comporter au moins {auth_svc.MIN_PASSWORD_LENGTH} caractères.",
        )

    try:
        target_role = orgs_repo.get_org_member_role(state.store, org_id, user_id)
        my_role = orgs_repo.get_org_member_role(state.store, org_id, state.current_user.id)
    except NotFoundError:
        return json_error(404, "not_found", "Membre introuvable dans cette organisation.")

    if rbac._RANK.get(target_role, 0) > rbac._RANK.get(my_role, 0):
        return json_error(403, "forbidden", "Impossible de modifier le mot de passe d'un rôle supérieur.")

    from auth.password import hash_password
    from store import users as user_store
    ph = hash_password(new_pw)
    user_store.update_password_hash(state.store, user_id, ph)
    return {"ok": True, "message": "Mot de passe réinitialisé avec succès."}
