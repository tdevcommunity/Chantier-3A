"""Online and offline-reconciled ticket admission routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth import rbac
from events import issue as issue_mod
from events import service as events_svc
from http_layer.deps import AppState, require_user
from http_layer.errors import json_error
from scan import admission
from scan.serial_web import (
    name_query_matches,
    normalize_pass_serial,
    parse_registration_form,
    preview_from_ticket_row,
)
from store import admissions as admissions_repo
from store import ticket_types as ticket_types_repo
from tickets import capability as cap

router = APIRouter(tags=["scan"])
ControlType = Literal["event_entry", "food_access", "merch_pickup", "after_entry"]


class ScanBody(BaseModel):
    """Signed ticket capability and scan context from a door device."""
    event_id: str
    capability: str
    device_id: str = ""
    gate_id: str = ""
    scanned_at: str = ""
    control_type: ControlType = "event_entry"


class SyncScanItem(BaseModel):
    """One durable operation produced by the mobile offline outbox."""
    operation_id: str
    capability: str
    device_id: str
    gate_id: str = ""
    scanned_at: str
    reported_result: Literal["admitted", "duplicate"] = "admitted"
    control_type: ControlType = "event_entry"


class SyncScanBody(BaseModel):
    """Bounded, idempotent batch of offline scan operations."""
    event_id: str
    operations: list[SyncScanItem] = Field(default_factory=list, max_length=500)


class LookupSerialBody(BaseModel):
    """Preview a ticket by public serial without recording admission."""
    event_id: str
    serial: str = ""
    serial_suffix: str = ""


class LookupNameBody(BaseModel):
    """Find tickets by participant name (web gate scanner)."""
    event_id: str
    query: str = ""


class ScanBySerialBody(BaseModel):
    """Record admission after agent confirmation."""
    event_id: str
    serial: str = ""
    serial_suffix: str = ""
    device_id: str = "web-scanner"
    gate_id: str = ""
    scanned_at: str = ""
    control_type: ControlType = "event_entry"


class _DbSeenSet:
    """Persists first admission per ticket and control type."""
    def __init__(self, st, event_id, gate_id, device_id, scanned_by, control_type) -> None:
        self._st = st
        self._event_id = event_id
        self._gate_id = gate_id
        self._device_id = device_id
        self._scanned_by = scanned_by
        self._control_type = control_type

    def mark_seen(self, ticket_id: str, at: datetime) -> tuple[bool, Exception | None]:
        ok = admissions_repo.try_insert_admitted(
            self._st,
            ticket_id=ticket_id,
            event_id=self._event_id,
            gate_id=self._gate_id,
            device_id=self._device_id,
            scanned_by=self._scanned_by or None,
            scanned_at=at,
            control_type=self._control_type,
        )
        return ok, None

    def seen(self, ticket_id: str) -> bool:
        rows = self._st.fetchall(
            """SELECT 1 FROM admissions
               WHERE ticket_id = ? AND control_type = ? AND result = 'admitted'
               LIMIT 1""",
            (ticket_id, self._control_type),
        )
        return bool(rows)


@router.get("/scan/events")
def list_scan_events(state: AppState = Depends(require_user)):
    """List published events the authenticated staff member may scan.

    The mobile application uses this endpoint during startup so an operator
    never has to know or configure an event identifier at build time.
    """
    memberships = state.store.fetchall(
        """SELECT org_id, role FROM org_members
           WHERE user_id = ?""",
        (state.current_user.id,),
    )
    events = []
    for membership in memberships:
        role = membership["role"]
        if not rbac.role_meets(role, rbac.ROLE_SCANNER):
            continue
        for event in events_svc.list_by_org(state.store, membership["org_id"]):
            if event["status"] != "published":
                continue
            events.append({**event, "scan_role": role})
    events.sort(key=lambda event: (event["starts_at"], event["id"]))
    return {"events": events}


def _parse_scanned_at(value: str) -> datetime:
    raw = value
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    return datetime.fromisoformat(raw).astimezone(timezone.utc)


def _participant_view(st, row) -> dict:
    options = st.fetchall(
        """SELECT tt.name, tt.product_kind, oi.quantity
           FROM order_items oi
           JOIN ticket_types tt ON tt.id = oi.ticket_type_id
           WHERE oi.order_id = ? AND tt.product_kind IN ('option', 'goodie')
           ORDER BY tt.sort_order ASC, tt.name ASC""",
        (row["order_id"],),
    )
    return {
        "first_name": row["buyer_first_name"] or "",
        "last_name": row["buyer_last_name"] or "",
        "holder_name": row["holder_name"] or "",
        "email": row["buyer_email"] or "",
        "school_name": row["school_name"] or "",
        "pass_type": row["pass_tier"] or row["ticket_type_name"] or "",
        "options": [
            {"name": option["name"], "kind": option["product_kind"], "quantity": option["quantity"]}
            for option in options
        ],
    }


def _ticket_details(st, ticket_id: str) -> dict:
    row = st.fetchone(
        """SELECT t.serial, t.holder_name, tt.name AS ticket_type_name,
                  tt.pass_tier, o.buyer_first_name, o.buyer_last_name,
                  o.buyer_email, o.school_name, t.order_id
           FROM tickets t
           JOIN ticket_types tt ON tt.id = t.ticket_type_id
           JOIN orders o ON o.id = t.order_id
           WHERE t.id = ?""",
        (ticket_id,),
    )
    if row is None:
        return {}
    return {
        "serial": row["serial"] or "",
        "holder_name": row["holder_name"] or "",
        "participant": _participant_view(st, row),
    }


def _control_allowed(st, ticket_type_id: str, control_type: str) -> bool:
    """Return the explicit organizer-configured right for one ticket type."""
    ticket_type = ticket_types_repo.get_ticket_type_by_id(st, ticket_type_id)
    return {
        "event_entry": ticket_type.access_event,
        "food_access": ticket_type.access_food,
        "merch_pickup": ticket_type.access_merch,
        "after_entry": ticket_type.access_after,
    }[control_type]


def _ticket_admitted(st, ticket_id: str, control_type: str) -> bool:
    rows = st.fetchall(
        """SELECT 1 FROM admissions
           WHERE ticket_id = ? AND control_type = ? AND result = 'admitted' LIMIT 1""",
        (ticket_id, control_type),
    )
    return bool(rows)


def _fetch_ticket_detail_row(st, event_id: str, serial: str):
    return st.fetchone(
        """SELECT t.id, t.serial, t.status, t.capability, t.holder_name, t.ticket_type_id,
                  tt.name AS ticket_type_name, tt.pass_tier,
                  o.buyer_email, o.buyer_first_name, o.buyer_last_name
           FROM tickets t
           JOIN ticket_types tt ON tt.id = t.ticket_type_id
           JOIN orders o ON o.id = t.order_id
           WHERE t.event_id = ? AND t.serial = ?""",
        (event_id, serial),
    )


def _event_serial_year(st, event_id: str) -> int:
    row = st.fetchone("SELECT starts_at FROM events WHERE id = ?", (event_id,))
    if row is None:
        return 2026
    raw = row["starts_at"] if hasattr(row, "keys") else row[0]
    if not raw:
        return 2026
    try:
        text = str(raw)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).year
    except (TypeError, ValueError):
        return 2026


def _perform_capability_scan(
    state: AppState,
    *,
    event_id: str,
    capability: str,
    gate_id: str,
    device_id: str,
    control_type: ControlType,
    scanned_at: str,
) -> dict:
    now = datetime.now(timezone.utc)
    if scanned_at:
        try:
            now = _parse_scanned_at(scanned_at)
        except ValueError:
            return json_error(400, "invalid_request", "scanned_at must be RFC3339")
    try:
        cap_eid = cap.peek_eid(capability)
    except cap.CapabilityError as err:
        return {"result": admission.Status.INVALID.value, "reason": str(err), "ticket_id": ""}
    ring = issue_mod.issuer_public_keys(state.store, cap_eid or event_id)
    try:
        verified = cap.verify_with_ring(capability, ring, now)
        if verified.eid == event_id and not _control_allowed(
            state.store, verified.tt, control_type
        ):
            return {
                "result": admission.Status.NOT_AUTHORIZED.value,
                "reason": "ticket does not grant this control",
                "ticket_id": verified.tid,
                "control_type": control_type,
            }
    except cap.CapabilityError:
        pass
    seen = _DbSeenSet(
        state.store, event_id, gate_id, device_id,
        state.current_user.id, control_type,
    )
    result = admission.decide(capability, ring, event_id, seen, now, store=state.store)
    ticket_id = result.payload.tid if result.payload else ""
    out = {
        "result": result.status.value,
        "reason": result.reason,
        "ticket_id": ticket_id,
        "serial": "",
        "holder_name": "",
        "participant": None,
        "control_type": control_type,
        "first_scan": None,
    }
    if ticket_id:
        out.update(_ticket_details(state.store, ticket_id))
    if result.status == admission.Status.DUPLICATE and ticket_id:
        out["first_scan"] = admissions_repo.first_admission(state.store, ticket_id, control_type)
    return out


@router.post("/scan")
def scan_ticket(body: ScanBody, state: AppState = Depends(require_user)):
    """Verify a capability and record an online control operation."""
    if not body.event_id or not body.capability:
        return json_error(400, "invalid_request", "event_id and capability are required")
    if not rbac.can_manage_event(state.store, state.current_user.id, body.event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not allowed to scan for this event")
    return _perform_capability_scan(
        state,
        event_id=body.event_id,
        capability=body.capability,
        gate_id=body.gate_id,
        device_id=body.device_id,
        control_type=body.control_type,
        scanned_at=body.scanned_at,
    )


@router.post("/scan/lookup-serial")
def lookup_scan_serial(body: LookupSerialBody, state: AppState = Depends(require_user)):
    """Preview ticket holder data from pass serial without recording admission."""
    if not body.event_id:
        return json_error(400, "invalid_request", "event_id is required")
    if not rbac.can_manage_event(state.store, state.current_user.id, body.event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not allowed to scan for this event")
    year = _event_serial_year(state.store, body.event_id)
    serial = normalize_pass_serial(serial=body.serial, serial_suffix=body.serial_suffix, year=year)
    if not serial:
        return {"found": False, "reason": "invalid_serial_format"}
    row = _fetch_ticket_detail_row(state.store, body.event_id, serial)
    if row is None:
        return {"found": False, "reason": "not_found"}
    status = row["status"] if hasattr(row, "keys") else row[2]
    if status != "valid":
        return {"found": False, "reason": "ticket_not_valid", "serial": serial}
    ticket_id = row["id"]
    admitted = _ticket_admitted(state.store, ticket_id, "event_entry")
    data = {
        "id": row["id"],
        "serial": row["serial"],
        "status": row["status"],
        "holder_name": row["holder_name"],
        "ticket_type_name": row["ticket_type_name"],
        "pass_tier": row["pass_tier"],
        "buyer_email": row["buyer_email"],
        "buyer_first_name": row["buyer_first_name"],
        "buyer_last_name": row["buyer_last_name"],
    }
    preview = preview_from_ticket_row(data, admitted=admitted)
    return {"found": True, "preview": preview}


@router.post("/scan/lookup-name")
def lookup_scan_name(body: LookupNameBody, state: AppState = Depends(require_user)):
    """Search valid tickets by participant name (max 10)."""
    if not body.event_id:
        return json_error(400, "invalid_request", "event_id is required")
    query = (body.query or "").strip()
    if len(query) < 3:
        return json_error(400, "invalid_request", "query must be at least 3 characters")
    if not rbac.can_manage_event(state.store, state.current_user.id, body.event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not allowed to scan for this event")
    rows = state.store.fetchall(
        """SELECT t.id, t.serial, t.status, t.holder_name,
                  tt.name AS ticket_type_name, tt.pass_tier,
                  o.buyer_email, o.buyer_first_name, o.buyer_last_name
           FROM tickets t
           JOIN ticket_types tt ON tt.id = t.ticket_type_id
           JOIN orders o ON o.id = t.order_id
           WHERE t.event_id = ? AND t.status = 'valid'
           ORDER BY t.issued_at ASC, t.id ASC""",
        (body.event_id,),
    )
    matches: list[dict] = []
    for row in rows:
        data = {
            "id": row["id"],
            "serial": row["serial"],
            "status": row["status"],
            "holder_name": row["holder_name"],
            "ticket_type_name": row["ticket_type_name"],
            "pass_tier": row["pass_tier"],
            "buyer_email": row["buyer_email"],
            "buyer_first_name": row["buyer_first_name"],
            "buyer_last_name": row["buyer_last_name"],
        }
        if not name_query_matches(data, query):
            continue
        admitted = _ticket_admitted(state.store, data["id"], "event_entry")
        matches.append(preview_from_ticket_row(data, admitted=admitted))
        if len(matches) >= 10:
            break
    return {"matches": matches, "truncated": len(matches) >= 10}


@router.post("/scan/by-serial")
def scan_by_serial(body: ScanBySerialBody, state: AppState = Depends(require_user)):
    """Record admission using public pass serial (web gate workflow)."""
    if not body.event_id:
        return json_error(400, "invalid_request", "event_id is required")
    if not rbac.can_manage_event(state.store, state.current_user.id, body.event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not allowed to scan for this event")
    year = _event_serial_year(state.store, body.event_id)
    serial = normalize_pass_serial(serial=body.serial, serial_suffix=body.serial_suffix, year=year)
    if not serial:
        return {"result": admission.Status.INVALID.value, "reason": "invalid serial", "ticket_id": ""}
    row = _fetch_ticket_detail_row(state.store, body.event_id, serial)
    if row is None:
        return {"result": admission.Status.INVALID.value, "reason": "pass not found", "ticket_id": ""}
    status = row["status"]
    capability = row["capability"]
    if status != "valid" or not capability:
        return {"result": admission.Status.INVALID.value, "reason": "ticket not valid", "ticket_id": ""}
    return _perform_capability_scan(
        state,
        event_id=body.event_id,
        capability=capability,
        gate_id=body.gate_id or "web-gate",
        device_id=body.device_id or "web-scanner",
        control_type=body.control_type,
        scanned_at=body.scanned_at,
    )


@router.post("/scan/sync")
def sync_scans(body: SyncScanBody, state: AppState = Depends(require_user)):
    """Verify and reconcile a bounded mobile outbox batch idempotently."""
    if not body.event_id:
        return json_error(400, "invalid_request", "event_id is required")
    if not rbac.can_manage_event(state.store, state.current_user.id, body.event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not allowed to scan for this event")
    ring = issue_mod.issuer_public_keys(state.store, body.event_id)
    results = []
    for item in body.operations:
        try:
            scanned_at = _parse_scanned_at(item.scanned_at)
        except (TypeError, ValueError):
            results.append({"operation_id": item.operation_id, "result": "invalid", "reason": "scanned_at must be RFC3339", "replayed": False})
            continue
        try:
            payload = cap.verify_with_ring(item.capability, ring, scanned_at)
        except cap.CapabilityError as err:
            results.append({"operation_id": item.operation_id, "result": "invalid", "reason": str(err), "replayed": False})
            continue
        if payload.eid != body.event_id:
            results.append({"operation_id": item.operation_id, "result": "wrong_event", "reason": "capability is for a different event", "replayed": False})
            continue
        if not _control_allowed(state.store, payload.tt, item.control_type):
            results.append({
                "operation_id": item.operation_id,
                "ticket_id": payload.tid,
                "result": "not_authorized",
                "reason": "ticket does not grant this control",
                "replayed": False,
            })
            continue
        blocked = admission.reject_if_ticket_not_valid(state.store, payload)
        if blocked is not None:
            results.append({"operation_id": item.operation_id, "result": blocked.status.value, "reason": blocked.reason, "replayed": False})
            continue
        result, replayed = admissions_repo.record_offline_claim(
            state.store,
            operation_id=item.operation_id,
            ticket_id=payload.tid,
            event_id=body.event_id,
            control_type=item.control_type,
            gate_id=item.gate_id,
            device_id=item.device_id,
            scanned_by=state.current_user.id,
            scanned_at=scanned_at,
            reported_result=item.reported_result,
        )
        results.append({
            "operation_id": item.operation_id,
            "ticket_id": payload.tid,
            "result": result,
            "reported_result": item.reported_result,
            "replayed": replayed,
            "first_scan": admissions_repo.first_admission(state.store, payload.tid, item.control_type),
        })
    return {"results": results}


@router.get("/events/{event_id}/scan-bundle")
def scan_bundle(event_id: str, state: AppState = Depends(require_user)):
    """Return the signed offline snapshot required by authorized scan devices."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not allowed to scan for this event")
    rows = state.store.fetchall(
        """SELECT t.id, t.capability, t.status, t.holder_name, t.ticket_type_id,
                  t.holder_user_id, t.order_id,
                  tt.name AS ticket_type_name, tt.pass_tier,
                  tt.access_event, tt.access_food, tt.access_merch, tt.access_after,
                  o.buyer_first_name, o.buyer_last_name, o.school_name
           FROM tickets t
           JOIN ticket_types tt ON tt.id = t.ticket_type_id
           JOIN orders o ON o.id = t.order_id
           WHERE t.event_id = ?
           ORDER BY t.issued_at ASC, t.id ASC""",
        (event_id,),
    )
    tickets = []
    for row in rows:
        tickets.append({
            "ticket_id": row["id"],
            "capability": row["capability"],
            "status": row["status"],
            "participant": {
                "participant_id": row["holder_user_id"] or row["order_id"],
                "first_name": row["buyer_first_name"] or "",
                "last_name": row["buyer_last_name"] or "",
                "holder_name": row["holder_name"] or "",
                "school_name": row["school_name"] or "",
                "pass_type": row["pass_tier"] or row["ticket_type_name"] or "",
            },
            "scan_rights": {
                "event_entry": bool(row["access_event"]),
                "food_access": bool(row["access_food"]),
                "merch_pickup": bool(row["access_merch"]),
                "after_entry": bool(row["access_after"]),
            },
        })
    return {
        "event_id": event_id,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "issuer_keys": events_svc.issuer_keys_json(state.store, event_id),
        "tickets": tickets,
    }


@router.get("/events/{event_id}/attendees")
def list_attendees(event_id: str, state: AppState = Depends(require_user)):
    """List attendees."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "forbidden")
    include_registration = rbac.can_manage_event(
        state.store, state.current_user.id, event_id, rbac.ROLE_ADMIN
    )
    rows = state.store.fetchall(
        """SELECT t.id, t.order_id, t.serial, t.holder_name, t.status, t.ticket_type_id,
                  tt.name AS ticket_type_name, tt.pass_tier,
                  o.buyer_email, o.buyer_first_name, o.buyer_last_name, o.school_name,
                  o.buyer_name, o.status AS order_status, o.total_minor, o.currency,
                  o.paid_at, o.created_at AS order_created_at, o.registration_form,
                  (SELECT a.scanned_at FROM admissions a
                   WHERE a.ticket_id = t.id AND a.result = 'admitted'
                   ORDER BY a.scanned_at ASC, a.id ASC LIMIT 1) AS admitted_at,
                  (SELECT a.control_type FROM admissions a
                   WHERE a.ticket_id = t.id AND a.result = 'admitted'
                   ORDER BY a.scanned_at ASC, a.id ASC LIMIT 1) AS control_type,
                  (SELECT a.gate_id FROM admissions a
                   WHERE a.ticket_id = t.id AND a.result = 'admitted'
                   ORDER BY a.scanned_at ASC, a.id ASC LIMIT 1) AS gate_id,
                  (SELECT a.device_id FROM admissions a
                   WHERE a.ticket_id = t.id AND a.result = 'admitted'
                   ORDER BY a.scanned_at ASC, a.id ASC LIMIT 1) AS device_id,
                  EXISTS(
                    SELECT 1 FROM admissions a
                    WHERE a.ticket_id = t.id AND a.result = 'admitted'
                  ) AS admitted
           FROM tickets t
           JOIN ticket_types tt ON tt.id = t.ticket_type_id
           JOIN orders o ON o.id = t.order_id
           WHERE t.event_id = ?
           ORDER BY t.issued_at ASC, t.id ASC""",
        (event_id,),
    )
    attendees = []
    for row in rows:
        admitted_raw = row["admitted"] if hasattr(row, "keys") else row[-1]
        admitted = bool(admitted_raw) if admitted_raw not in (0, "0", False, None) else False
        admitted_at = row["admitted_at"] if hasattr(row, "keys") else None
        entry = {
            "ticket_id": row["id"], "order_id": row["order_id"], "serial": row["serial"],
            "holder_name": row["holder_name"], "status": row["status"],
            "ticket_type_id": row["ticket_type_id"], "ticket_type_name": row["ticket_type_name"],
            "pass_type": row["pass_tier"] or row["ticket_type_name"], "email": row["buyer_email"],
            "first_name": row["buyer_first_name"] or "", "last_name": row["buyer_last_name"] or "",
            "school_name": row["school_name"] or "",
            "admitted": admitted,
            "admitted_at": admitted_at,
            "control_type": row["control_type"] if hasattr(row, "keys") else None,
            "gate_id": row["gate_id"] if hasattr(row, "keys") else None,
            "device_id": row["device_id"] if hasattr(row, "keys") else None,
            "scanned_at": admitted_at,
        }
        if include_registration:
            raw_form = row["registration_form"] if hasattr(row, "keys") else None
            entry["registration_form"] = parse_registration_form(raw_form)
            entry["order_status"] = row["order_status"] or ""
            entry["buyer_name"] = row["buyer_name"] or ""
            entry["total_minor"] = row["total_minor"] or 0
            entry["currency"] = row["currency"] or ""
            entry["paid_at"] = row["paid_at"] or ""
            entry["order_created_at"] = row["order_created_at"] or ""
        attendees.append(entry)
    return {"attendees": attendees}
