"""Visitor checkout and order status routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from auth import rbac
from http_layer.deps import AppState, get_app_state, require_user
from http_layer.errors import json_error
from orders import registration as reg
from orders.service import CreateOrderInput, OrderItemInput, OrdersError
from payments import types as pt
from payments.manual import ManualProvider
from notify.ticket_image import TicketImageInput, render_pass_ticket_pdf, render_pass_ticket_png
from events.festival_schedule import format_event_when_label
from events.passes import display_ticket_name
from store.store import NotFoundError

router = APIRouter(tags=["orders"])


def _venue_line(venue: str, address: str) -> str:
    parts = [venue.strip(), address.strip()]
    joined = ", ".join(p for p in parts if p)
    return joined or "Lieu à confirmer"


class OrderItemBody(BaseModel):
    """Single line item: ticket type id and quantity."""
    ticket_type_id: str
    quantity: int


class BuyerBody(BaseModel):
    """Guest checkout and official participant form (PDF V1)."""
    email: str
    first_name: str = ""
    last_name: str = ""
    name: str = ""
    school_name: str = ""
    motivation: str = ""
    wish: str = ""
    form: dict = Field(default_factory=dict)


class CreateOrderBody(BaseModel):
    """Request body to start checkout for an event."""
    event_id: str
    items: list[OrderItemBody]
    buyer: BuyerBody
    provider: str = ""
    return_path: str = ""


def _registration_json(o) -> dict:
    """Internal: pass registration fields for admin review."""
    form = getattr(o, "registration_form", None)
    if isinstance(form, str):
        form = reg.parse_form(form)
    elif not isinstance(form, dict):
        form = {}
    return {
        "first_name": getattr(o, "buyer_first_name", "") or "",
        "last_name": getattr(o, "buyer_last_name", "") or "",
        "email": o.buyer_email,
        "school_name": getattr(o, "school_name", "") or "",
        "motivation": getattr(o, "motivation", "") or "",
        "wish": getattr(o, "wish", "") or "",
        "form": form,
    }


def _order_json(o) -> dict:
    """Internal: order json."""
    out = {
        "id": o.id,
        "event_id": o.event_id,
        "user_id": o.user_id,
        "buyer_email": o.buyer_email,
        "buyer_name": o.buyer_name,
        "registration": _registration_json(o),
        "status": o.status,
        "subtotal_minor": o.subtotal_minor,
        "fee_minor": o.fee_minor,
        "total_minor": o.total_minor,
        "currency": o.currency,
        "provider": o.provider,
        "provider_ref": o.provider_ref,
        "created_at": o.created_at.isoformat().replace("+00:00", "Z"),
    }
    if o.paid_at:
        out["paid_at"] = o.paid_at.isoformat().replace("+00:00", "Z")
    if o.items is not None:
        out["items"] = o.items
    return out


def _tickets_json(tickets) -> list[dict]:
    """Internal: tickets json."""
    return [
        {
            "id": t.id,
            "order_id": t.order_id,
            "event_id": t.event_id,
            "ticket_type_id": t.ticket_type_id,
            "holder_user_id": t.holder_user_id,
            "holder_name": t.holder_name,
            "serial": t.serial,
            "capability": t.capability,
            "status": t.status,
            "issued_at": t.issued_at.isoformat().replace("+00:00", "Z"),
        }
        for t in tickets
    ]


def _guest_tickets_json(st, order_id: str) -> list[dict]:
    """Guest-facing tickets with event and pass labels for the mobile billet UI."""
    from store import events_repo
    from store import tickets as tickets_repo

    rows = tickets_repo.list_tickets_for_order(st, order_id)
    if not rows:
        return []
    tickets = _tickets_json(rows)
    event_id = rows[0].event_id
    event_title = ""
    event_venue = ""
    event_starts = ""
    event_ends = ""
    event_tz = ""
    try:
        ev = events_repo.get_event_by_id(st, event_id)
        event_title = ev.title
        event_venue = ev.venue_name or ""
        event_starts = ev.starts_at.isoformat().replace("+00:00", "Z")
        event_ends = ev.ends_at.isoformat().replace("+00:00", "Z")
        event_tz = ev.timezone or ""
    except NotFoundError:
        pass
    type_names: dict[str, str] = {}
    for t in tickets:
        tt_id = t["ticket_type_id"]
        if tt_id not in type_names:
            row = st.fetchone("SELECT name FROM ticket_types WHERE id = ?", (tt_id,))
            if row is None:
                type_names[tt_id] = "Pass"
            else:
                raw = row["name"] if hasattr(row, "keys") else row[0]
                type_names[tt_id] = display_ticket_name(raw)
        t["event_title"] = event_title
        t["event_venue_name"] = event_venue
        t["event_starts_at"] = event_starts
        t["event_ends_at"] = event_ends
        t["event_timezone"] = event_tz
        t["ticket_type_name"] = type_names[tt_id]
    return tickets


def _ticket_when_label(picked: dict) -> str | None:
    return format_event_when_label(
        picked.get("event_starts_at"),
        ends_at_iso=picked.get("event_ends_at"),
        tz_name=picked.get("event_timezone") or None,
    )


@router.post("/orders", status_code=201)
def create_order(body: CreateOrderBody, state: AppState = Depends(get_app_state)):
    """Create order."""
    if not body.event_id or not body.items or not body.buyer.email:
        return json_error(400, "invalid_request", "event_id, at least one item, and buyer.email are required")
    for it in body.items:
        if not it.ticket_type_id or it.quantity <= 0:
            return json_error(
                400,
                "invalid_request",
                "each item requires ticket_type_id and a positive quantity",
            )
    inp = CreateOrderInput(
        event_id=body.event_id,
        buyer_email=body.buyer.email,
        buyer_name=body.buyer.name,
        buyer_first_name=body.buyer.first_name,
        buyer_last_name=body.buyer.last_name,
        school_name=body.buyer.school_name,
        motivation=body.buyer.motivation,
        wish=body.buyer.wish,
        registration_form=body.buyer.form,
        items=[OrderItemInput(t.ticket_type_id, t.quantity) for t in body.items],
        provider=body.provider,
        return_path=body.return_path,
    )
    if state.current_user:
        inp.user_id = state.current_user.id
    try:
        order, charge = state.services.orders.create(inp)
    except NotFoundError:
        return json_error(404, "not_found", "event or ticket type not found")
    except OrdersError as err:
        from orders.service import ErrDuplicateBuyerEmail

        if err is ErrDuplicateBuyerEmail:
            return json_error(
                409,
                "duplicate_registration",
                "Cette adresse e-mail est déjà inscrite pour cet événement.",
            )
        message = str(err)
        if message.startswith("orders:"):
            message = "Inscription impossible. Vérifiez vos informations et réessayez."
        elif message.startswith("Formulaire incomplet"):
            pass
        elif "Mobile Money invalide" in message or "phone_number" in message:
            message = (
                "Numéro Mobile Money invalide. Utilisez le format international sans 0 initial "
                "(ex. 22890123456 pour le Togo, 22997123456 pour le Bénin)."
            )
        elif message.startswith("Accès refusé") or "whitelist" in message.lower():
            message = (
                f"{message} "
                "Ajoutez http://127.0.0.1:5173 et http://localhost:5173 dans la whitelist de votre application Velto."
            )
        return json_error(400, "invalid_request", message)
    except Exception:
        return json_error(500, "internal_error", "Service billetterie temporairement indisponible.")
    return {
        "order": _order_json(order),
        "payment": {
            "provider": charge.provider,
            "redirect_url": charge.redirect_url,
            "reference": charge.reference,
            "instructions": charge.instructions,
            "client_token": charge.client_token,
        },
    }


@router.get("/orders")
def list_my_orders(state: AppState = Depends(require_user)):
    """List my orders."""
    orders = state.services.orders.list_for_user(state.current_user.id)
    return {"orders": [_order_json(o) for o in orders]}


@router.get("/orders/{order_id}")
def get_order(order_id: str, state: AppState = Depends(require_user)):
    """Get order."""
    try:
        order = state.services.orders.get(order_id)
    except NotFoundError:
        return json_error(404, "not_found", "order not found")
    is_buyer = bool(order.user_id and order.user_id == state.current_user.id)
    is_staff = rbac.can_manage_event(
        state.store, state.current_user.id, order.event_id, rbac.ROLE_ADMIN
    )
    if not is_buyer and not is_staff:
        return json_error(404, "not_found", "order not found")
    payload = _order_json(order)
    if is_staff:
        payload["tickets"] = _guest_tickets_json(state.store, order_id)
    return {"order": payload}


@router.get("/orders/{order_id}/guest")
def get_order_guest(
    order_id: str,
    email: str = Query(""),
    state: AppState = Depends(get_app_state),
):
    """Guest order lookup by id + buyer email (no account required)."""
    buyer_email = email.strip().lower()
    if not buyer_email:
        return json_error(400, "invalid_request", "email query parameter is required")
    try:
        order = state.services.orders.get(order_id)
    except NotFoundError:
        return json_error(404, "not_found", "order not found")
    if order.buyer_email.strip().lower() != buyer_email:
        return json_error(404, "not_found", "order not found")
    tickets = _guest_tickets_json(state.store, order_id) if order.status == "paid" else []
    return {"order": _order_json(order), "tickets": tickets}


@router.get("/orders/{order_id}/guest/ticket.png")
def guest_ticket_png(
    order_id: str,
    email: str = Query(""),
    ticket: str = Query(""),
    state: AppState = Depends(get_app_state),
):
    """PNG pass (same asset as e-mail attachment) for guest download."""
    buyer_email = email.strip().lower()
    if not buyer_email:
        return json_error(400, "invalid_request", "email query parameter is required")
    try:
        order = state.services.orders.get(order_id)
    except NotFoundError:
        return json_error(404, "not_found", "order not found")
    if order.buyer_email.strip().lower() != buyer_email:
        return json_error(404, "not_found", "order not found")
    if order.status != "paid":
        return json_error(400, "invalid_request", "ticket not available until order is paid")
    tickets = _guest_tickets_json(state.store, order_id)
    if not tickets:
        return json_error(404, "not_found", "no ticket issued for this order")
    ticket_id = ticket.strip()
    picked = None
    if ticket_id:
        for row in tickets:
            if row["id"] == ticket_id:
                picked = row
                break
    if picked is None:
        picked = tickets[0]
    reg = _registration_json(order)
    holder = f"{reg.get('first_name', '')} {reg.get('last_name', '')}".strip() or order.buyer_name
    venue = picked.get("event_venue_name") or ""
    addr = ""
    try:
        from store import events_repo

        ev = events_repo.get_event_by_id(state.store, order.event_id)
        if not venue:
            venue = ev.venue_name or ""
        addr = ev.address or ""
    except NotFoundError:
        pass
    if not picked.get("capability"):
        return json_error(404, "not_found", "ticket capability missing")
    png = render_pass_ticket_png(
        TicketImageInput(
            event_title=picked.get("event_title") or "Tdev Festival 2026",
            pass_label=picked.get("ticket_type_name") or "Pass",
            holder_name=holder,
            when_label=_ticket_when_label(picked),
            venue_line=_venue_line(venue, addr),
            serial=picked["serial"],
            capability=picked["capability"],
        )
    )
    filename = f"billet-{picked['serial']}.png"
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def build_ticket_pdf_bytes(state: AppState, order_id: str, *, ticket_id: str = "") -> tuple[bytes, str]:
    """Render one ticket PDF for an order (staff or guest flows)."""
    order = state.services.orders.get(order_id)
    if order.status != "paid":
        raise ValueError("not_paid")
    tickets = _guest_tickets_json(state.store, order_id)
    if not tickets:
        raise ValueError("no_tickets")
    picked = None
    tid = ticket_id.strip()
    if tid:
        for row in tickets:
            if row["id"] == tid:
                picked = row
                break
    if picked is None:
        picked = tickets[0]
    if not picked.get("capability"):
        raise ValueError("no_capability")
    reg = _registration_json(order)
    holder = f"{reg.get('first_name', '')} {reg.get('last_name', '')}".strip() or order.buyer_name
    venue = picked.get("event_venue_name") or ""
    addr = ""
    try:
        from store import events_repo

        ev = events_repo.get_event_by_id(state.store, order.event_id)
        if not venue:
            venue = ev.venue_name or ""
        addr = ev.address or ""
    except NotFoundError:
        pass
    pdf = render_pass_ticket_pdf(
        TicketImageInput(
            event_title=picked.get("event_title") or "Tdev Festival 2026",
            pass_label=picked.get("ticket_type_name") or "Pass",
            holder_name=holder,
            when_label=_ticket_when_label(picked),
            venue_line=_venue_line(venue, addr),
            serial=picked["serial"],
            capability=picked["capability"],
        )
    )
    return pdf, f"billet-{picked['serial']}.pdf"


@router.get("/orders/{order_id}/guest/ticket.pdf")
def guest_ticket_pdf(
    order_id: str,
    email: str = Query(""),
    ticket: str = Query(""),
    state: AppState = Depends(get_app_state),
):
    """PDF pass (same render as e-mail attachment) for guest download."""
    buyer_email = email.strip().lower()
    if not buyer_email:
        return json_error(400, "invalid_request", "email query parameter is required")
    try:
        order = state.services.orders.get(order_id)
    except NotFoundError:
        return json_error(404, "not_found", "order not found")
    if order.buyer_email.strip().lower() != buyer_email:
        return json_error(404, "not_found", "order not found")
    try:
        pdf, filename = build_ticket_pdf_bytes(state, order_id, ticket_id=ticket.strip())
    except ValueError as err:
        code = str(err)
        if code == "not_paid":
            return json_error(400, "invalid_request", "ticket not available until order is paid")
        return json_error(404, "not_found", "ticket not found")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/events/{event_id}/orders")
def list_event_orders(event_id: str, state: AppState = Depends(require_user)):
    """List event orders."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this event's org")
    orders = state.services.orders.list_for_event(event_id)
    views = []
    for ord in orders:
        view = _order_json(ord)
        if ord.provider == pt.PROVIDER_NAME_MANUAL:
            provider = state.services.payments.get(pt.PROVIDER_NAME_MANUAL)
            if isinstance(provider, ManualProvider):
                rec, ok = provider.record(ord.id)
                if ok and rec.get("marked_by"):
                    view["marked_by"] = rec["marked_by"]
                    if rec.get("marked_at"):
                        view["marked_at"] = rec["marked_at"].isoformat().replace("+00:00", "Z")
        views.append(view)
    return {"orders": views}


@router.post("/orders/{order_id}/mark-paid")
def mark_order_paid(order_id: str, state: AppState = Depends(require_user)):
    """Mark order paid."""
    return _mark_order(order_id, state, paid=True)


@router.post("/orders/{order_id}/mark-failed")
def mark_order_failed(order_id: str, state: AppState = Depends(require_user)):
    """Mark order failed."""
    return _mark_order(order_id, state, paid=False)


def _mark_order(order_id: str, state: AppState, *, paid: bool):
    """Internal: mark order."""
    try:
        ord = state.services.orders.get(order_id)
    except NotFoundError:
        return json_error(404, "not_found", "order not found")
    if not rbac.can_manage_event(state.store, state.current_user.id, ord.event_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this event's org")
    if ord.provider != pt.PROVIDER_NAME_MANUAL:
        return json_error(400, "invalid_request", "order was not created with the manual payment provider")
    provider = state.services.payments.get(pt.PROVIDER_NAME_MANUAL)
    if not isinstance(provider, ManualProvider):
        return json_error(500, "internal_error", "manual provider unavailable")
    marked_by = state.current_user.email
    if paid:
        if ord.status not in ("pending", "paid"):
            return json_error(409, "conflict", f"order cannot be marked paid from status {ord.status}")
        result = provider.mark_paid(order_id, marked_by)
        try:
            updated, tickets = state.services.orders.settle(result)
        except OrdersError:
            return json_error(409, "conflict", "order could not be settled from its current status")
        return {"order": _order_json(updated), "tickets": _tickets_json(tickets)}
    if ord.status == "failed":
        return {"order": _order_json(ord)}
    if ord.status != "pending":
        return json_error(409, "conflict", f"order cannot be marked failed from status {ord.status}")
    provider.mark_failed(order_id, marked_by)
    try:
        updated = state.services.orders.mark_failed(order_id)
    except OrdersError:
        return json_error(409, "conflict", "order could not be marked failed from its current status")
    return {"order": _order_json(updated)}
