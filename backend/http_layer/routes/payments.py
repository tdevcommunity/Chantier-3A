"""Payment provider selection, webhooks, and manual confirm routes."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request

from auth.email_canonical import canonical_email
from http_layer.deps import AppState, get_app_state
from http_layer.errors import json_error
from orders.service import OrdersError
from payments import orchestration
from payments import types as pt
from payments.velto import PROVIDER_NAME_VELTO, VeltoProvider
from store.store import NotFoundError

router = APIRouter(prefix="/payments", tags=["payments"])


class _VeltoOrderVerify:
    """Velto verify bound to the transaction id stored on the order."""

    def __init__(self, inner: VeltoProvider, provider_ref: str | None) -> None:
        self._inner = inner
        self._provider_ref = provider_ref

    def name(self) -> str:
        return self._inner.name()

    def capabilities(self):
        return self._inner.capabilities()

    def begin(self, order: pt.Order) -> pt.Charge:
        return self._inner.begin(order)

    def verify(self, reference: str) -> pt.Result:
        return self._inner.verify_for_order(reference, self._provider_ref)

    def webhook(self, body: bytes, headers: dict[str, str]) -> pt.Result:
        return self._inner.webhook(body, headers)


class _OrderLookup:
    """Internal: OrderLookup."""
    def __init__(self, state: AppState) -> None:
        """Initialize ``_OrderLookup``."""
        self._state = state

    def lookup(self, reference: str) -> pt.OrderRef:
        """Lookup on ``_OrderLookup``."""
        order = self._state.services.orders.get(reference)
        return pt.OrderRef(id=order.id, amount_minor=order.total_minor, currency=order.currency)


def _bind_velto_txn(state: AppState, order, velto_txn: str) -> str | None:
    """Persist Velto transaction id from the checkout return URL when missing in DB."""
    from store import orders as orders_repo

    hint = velto_txn.strip()
    ref = (order.provider_ref or "").strip()
    if not hint or not hint.startswith("tnx_"):
        return ref or None
    if ref and ref != order.id and ref.startswith("tnx_"):
        return ref
    provider = state.services.payments.get(order.provider)
    if isinstance(provider, VeltoProvider) and provider._fetch_txn_by_id(hint) is None:
        return ref or None
    orders_repo.update_provider_ref(state.store, order.id, hint)
    return hint


def _provider_poll(
    state: AppState,
    order,
    *,
    velto_txn: str = "",
) -> pt.Result:
    provider = state.services.payments.get(order.provider)
    if provider is None:
        raise ValueError("provider not registered")
    if order.provider == PROVIDER_NAME_VELTO and isinstance(provider, VeltoProvider):
        bound = _bind_velto_txn(state, order, velto_txn)
        return provider.verify_for_order(order.id, bound)
    return provider.verify(order.id)


@router.post("/status")
def payment_status(body: dict, state: AppState = Depends(get_app_state)):
    """Poll provider payment state without issuing tickets."""
    reference = (body.get("reference") or "").strip()
    velto_txn = (body.get("velto_transaction_id") or "").strip()
    if not reference:
        return json_error(400, "invalid_request", "reference is required")
    try:
        order = state.services.orders.get(reference)
    except NotFoundError:
        return json_error(404, "not_found", "order not found")
    if order.status == "paid":
        return {"payment_status": "paid", "order_status": order.status}
    try:
        result = _provider_poll(state, order, velto_txn=velto_txn)
        pay_status = result.status.value
    except Exception:
        pay_status = pt.Status.PENDING.value
    return {"payment_status": pay_status, "order_status": order.status}


@router.post("/abandon")
def abandon_pending_payment(body: dict, state: AppState = Depends(get_app_state)):
    """Release a pending checkout after a failed or cancelled Mobile Money attempt."""
    reference = (body.get("reference") or "").strip()
    raw_email = (body.get("email") or "").strip()
    if not reference:
        return json_error(400, "invalid_request", "Référence de commande requise.")
    try:
        order = state.services.orders.get(reference)
    except NotFoundError:
        return json_error(404, "not_found", "Commande introuvable.")
    if order.status != "pending":
        return {"order": _order_json(order), "released": False}
    if raw_email:
        try:
            email = canonical_email(raw_email)
        except ValueError:
            return json_error(400, "invalid_request", "Adresse e-mail invalide.")
        try:
            if canonical_email(order.buyer_email) != email:
                return json_error(404, "not_found", "Commande introuvable.")
        except ValueError:
            if order.buyer_email.strip().lower() != email:
                return json_error(404, "not_found", "Commande introuvable.")
    try:
        updated = state.services.orders.mark_failed(reference)
    except OrdersError:
        return json_error(409, "conflict", "order could not be released")
    return {"order": _order_json(updated), "released": True}


def _email_matches_order(order, raw_email: str) -> bool:
    try:
        return canonical_email(order.buyer_email) == canonical_email(raw_email)
    except ValueError:
        return False


@router.post("/verify")
def verify_payment(body: dict, state: AppState = Depends(get_app_state)):
    """Verify payment."""
    reference = (body.get("reference") or "").strip()
    velto_txn = (body.get("velto_transaction_id") or "").strip()
    raw_email = (body.get("email") or "").strip()
    if not reference:
        return json_error(400, "invalid_request", "Référence de commande requise.")
    if not raw_email:
        return json_error(400, "invalid_request", "Adresse e-mail requise.")
    try:
        canonical_email(raw_email)
    except ValueError:
        return json_error(400, "invalid_request", "Adresse e-mail invalide.")
    try:
        order = state.services.orders.get(reference)
    except NotFoundError:
        return json_error(404, "not_found", "Commande introuvable.")
    if not _email_matches_order(order, raw_email):
        return json_error(404, "not_found", "Commande introuvable.")
    provider = state.services.payments.get(order.provider)
    if provider is None:
        return json_error(500, "internal_error", "provider not registered")
    bound = ""
    if order.provider == PROVIDER_NAME_VELTO:
        bound = _bind_velto_txn(state, order, velto_txn) or ""
        order = state.services.orders.get(reference)
    lookup = _OrderLookup(state)
    provider_ref = (order.provider_ref or "").strip()
    if provider_ref == reference:
        provider_ref = bound if bound.startswith("tnx_") else ""
    try:
        if order.provider == PROVIDER_NAME_VELTO and isinstance(provider, VeltoProvider):
            result = orchestration.handle_verify(
                _VeltoOrderVerify(provider, provider_ref or None),
                reference,
                lookup,
            )
        else:
            result = orchestration.handle_verify(provider, reference, lookup)
    except Exception:
        return json_error(402, "payment_not_confirmed", "payment could not be verified as paid")
    if result.status != pt.Status.PAID:
        return json_error(402, "payment_not_confirmed", "payment could not be verified as paid")
    try:
        _, tickets = state.services.orders.settle(result)
    except Exception as exc:
        msg = str(exc).lower()
        if "signing key unavailable" in msg or "vault locked" in msg:
            return json_error(
                503,
                "ticketing_unavailable",
                "Paiement reçu mais émission du billet impossible (coffre de clés). Contactez l'organisateur.",
            )
        try:
            existing = state.services.orders.get(reference)
            if existing.status == "paid":
                minted = state.services.orders.tickets_for_order(reference)
                from http_layer.routes.orders import _verify_success_order_json

                return {
                    "order": _verify_success_order_json(existing),
                    "tickets": _tickets_json(minted),
                }
        except NotFoundError:
            pass
        return json_error(500, "internal_error", "internal error")
    updated = state.services.orders.get(reference)
    from http_layer.routes.orders import _verify_success_order_json

    return {
        "order": _verify_success_order_json(updated),
        "tickets": _tickets_json(tickets),
    }


@router.post("/webhook/{provider_name}")
async def payment_webhook(
    provider_name: str,
    request: Request,
    state: AppState = Depends(get_app_state),
):
    """Payment webhook."""
    provider = state.services.payments.get(provider_name)
    if provider is None:
        return json_error(404, "not_found", "unknown payment provider")
    body = await request.body()
    headers = {k: v for k, v in request.headers.items()}
    lookup = _OrderLookup(state)
    try:
        result = orchestration.handle_webhook(
            provider,
            body,
            headers,
            state.services.webhook_seen,
            lookup,
        )
    except Exception as err:
        # ErrReplayed / ErrUnhandledEvent are exception instances, not classes: they cannot
        # appear in an `except` clause (that raises TypeError and turned rejections into 500s).
        if err is pt.ErrReplayed or err is pt.ErrUnhandledEvent:
            return {}
        return json_error(400, "invalid_request", "webhook rejected")
    if result.status != pt.Status.PAID:
        return {}
    try:
        state.services.orders.settle(result)
    except OrdersError:
        return json_error(500, "internal_error", "internal error")
    return {}


def _order_json(o) -> dict:
    """Internal: order json."""
    from http_layer.routes.orders import _registration_json

    out = {
        "id": o.id,
        "event_id": o.event_id,
        "status": o.status,
        "total_minor": o.total_minor,
        "currency": o.currency,
        "provider": o.provider,
        "registration": _registration_json(o),
    }
    if o.paid_at:
        out["paid_at"] = o.paid_at.isoformat().replace("+00:00", "Z")
    return out


def _tickets_json(tickets) -> list[dict]:
    """Internal: tickets json."""
    from http_layer.routes.orders import _tickets_json as full

    return full(tickets)
