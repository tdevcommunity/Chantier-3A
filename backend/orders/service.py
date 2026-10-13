"""Create orders, reserve inventory, and finalize after payment."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
from urllib.parse import urlencode

from events import issue as issue_mod
from events.passes import PASS_TIER_STUDENT, PASS_TIER_VIP
from orders import registration as reg
from payments import types as pt
from payments.registry import Registry
from store import (
    events_repo,
    order_items as order_items_repo,
    orders as orders_repo,
    pass_serial,
    ticket_types as tt_repo,
    tickets as tickets_repo,
)
from store.store import NotFoundError, SoldOutError, Store, new_ulid
from tickets import capability as cap


class PaidNotifier(Protocol):
    """Paidnotifier."""
    def on_order_paid(self, order_id: str) -> None: ...


class OrdersError(Exception):
    """Orderserror."""
    pass


ErrEmptyOrder = OrdersError("orders: order must contain at least one item")
ErrInvalidQuantity = OrdersError("orders: quantity must be positive")
ErrTicketTypeNotFound = OrdersError("orders: ticket type not found for this event")
ErrTicketTypeNotAvailable = OrdersError("orders: ticket type is not currently on sale")
ErrMaxPerOrderExceeded = OrdersError("orders: quantity exceeds this ticket type's max per order")
ErrEventNotPublished = OrdersError("orders: event is not published")
ErrSoldOut = OrdersError("orders: sold out")
ErrProviderRequired = OrdersError("orders: a payment provider must be specified")
ErrUnknownProvider = OrdersError("orders: unknown payment provider")
ErrPaymentUnavailable = OrdersError("orders: payment provider unavailable, please retry")
ErrOrderNotSettleable = OrdersError("orders: order cannot be settled from its current status")
ErrOrderNotPending = OrdersError("orders: order is not pending")
ErrRegistrationIncomplete = OrdersError("orders: incomplete pass registration")
ErrDuplicateBuyerEmail = OrdersError("orders: buyer email already registered for this event")


@dataclass
class OrderItemInput:
    """Orderiteminput."""
    ticket_type_id: str
    quantity: int


@dataclass
class CreateOrderInput:
    """Createorderinput."""
    event_id: str
    user_id: str = ""
    buyer_email: str = ""
    buyer_name: str = ""
    buyer_first_name: str = ""
    buyer_last_name: str = ""
    school_name: str = ""
    motivation: str = ""
    wish: str = ""
    registration_form: dict | None = None
    items: list[OrderItemInput] | None = None
    provider: str = ""
    callback_url: str = ""
    return_path: str = ""


@dataclass
class OrderView:
    """Orderview."""
    id: str
    event_id: str
    user_id: str
    buyer_email: str
    buyer_name: str
    buyer_first_name: str
    buyer_last_name: str
    school_name: str
    motivation: str
    wish: str
    status: str
    subtotal_minor: int
    fee_minor: int
    total_minor: int
    currency: str
    provider: str
    provider_ref: str
    created_at: datetime
    paid_at: datetime | None = None
    items: list[dict] | None = None
    registration_form: dict | None = None


@dataclass
class TicketView:
    """Ticketview."""
    id: str
    order_id: str
    event_id: str
    ticket_type_id: str
    holder_user_id: str
    holder_name: str
    serial: str
    capability: str
    status: str
    issued_at: datetime


class OrdersService:
    """Ordersservice."""
    def __init__(
        self,
        store: Store,
        payments: Registry,
        notify: PaidNotifier | None = None,
        storefront_url: str = "",
    ) -> None:
        """Initialize ``OrdersService``."""
        self._store = store
        self._payments = payments
        self._notify = notify
        self._storefront_url = storefront_url.strip()

    def create(self, inp: CreateOrderInput) -> tuple[OrderView, pt.Charge]:
        """Create on ``OrdersService``."""
        items = inp.items or []
        if not items:
            raise ErrEmptyOrder
        ev = events_repo.get_event_by_id(self._store, inp.event_id)
        if ev.status != "published":
            raise ErrEventNotPublished
        currency = ev.currency.strip().upper()
        now = datetime.now(timezone.utc)
        tt_ids = [it.ticket_type_id for it in items]
        needs_reg = reg.order_needs_pass_registration(self._store, inp.event_id, tt_ids)
        try:
            registration = reg.normalize_registration(
                email=inp.buyer_email,
                first_name=inp.buyer_first_name,
                last_name=inp.buyer_last_name,
                legacy_name=inp.buyer_name,
                school_name=inp.school_name,
                motivation=inp.motivation,
                wish=inp.wish,
                form=inp.registration_form,
                required=needs_reg,
            )
        except reg.RegistrationError as err:
            raise OrdersError(str(err)) from err
        orders_repo.cancel_pending_orders_for_event_email(
            self._store, inp.event_id, registration.email
        )
        if orders_repo.has_active_order_for_event_email(
            self._store, inp.event_id, registration.email
        ):
            raise ErrDuplicateBuyerEmail
        holder_name = f"{registration.first_name} {registration.last_name}".strip() or inp.buyer_name.strip()
        lines: list[orders_repo.OrderLine] = []
        subtotal = 0
        for item in items:
            if item.quantity <= 0:
                raise ErrInvalidQuantity
            tt = tt_repo.get_ticket_type_by_id(self._store, item.ticket_type_id)
            if tt.event_id != inp.event_id:
                raise ErrTicketTypeNotFound
            if tt.status != "active":
                raise ErrTicketTypeNotAvailable
            if tt.sales_start and now < tt.sales_start:
                raise ErrTicketTypeNotAvailable
            if tt.sales_end and now > tt.sales_end:
                raise ErrTicketTypeNotAvailable
            if tt.max_per_order > 0 and item.quantity > tt.max_per_order:
                raise ErrMaxPerOrderExceeded
            unit = tt.price_minor
            subtotal += unit * item.quantity
            lines.append(
                orders_repo.OrderLine(
                    ticket_type_id=tt.id,
                    quantity=item.quantity,
                    unit_price_minor=unit,
                )
            )
        provider = self._resolve_provider(inp.provider, amount_minor=subtotal)
        if subtotal > 0 and provider.name() == pt.PROVIDER_NAME_FREE:
            raise ErrPaymentUnavailable
        order_id = new_ulid()
        ord_row = orders_repo.Order(
            id=order_id,
            event_id=inp.event_id,
            user_id=inp.user_id or None,
            buyer_email=registration.email,
            buyer_name=holder_name,
            buyer_first_name=registration.first_name,
            buyer_last_name=registration.last_name,
            school_name=registration.school_name,
            motivation=registration.motivation,
            wish=registration.wish,
            registration_form=reg.dump_form(registration.form),
            status="pending",
            subtotal_minor=subtotal,
            fee_minor=0,
            total_minor=subtotal,
            currency=currency,
            provider=provider.name(),
            provider_ref=None,
            created_at=now,
            paid_at=None,
        )
        try:
            order_items = orders_repo.create_order_with_items(self._store, ord_row, lines)
        except SoldOutError as err:
            raise ErrSoldOut from err
        except NotFoundError as err:
            raise ErrTicketTypeNotFound from err
        callback_url = self._payment_callback_url(order_id, inp)
        try:
            charge = provider.begin(
                pt.Order(
                    reference=order_id,
                    event_id=inp.event_id,
                    buyer_email=registration.email,
                    buyer_name=holder_name,
                    amount_minor=subtotal,
                    currency=currency,
                    callback_url=callback_url,
                    metadata={},
                )
            )
        except ValueError as err:
            orders_repo.cancel_order_release_inventory(self._store, order_id)
            msg = str(err)
            if msg.startswith("velto:"):
                raise OrdersError(msg[6:].strip()) from err
            raise ErrPaymentUnavailable from err
        except Exception as err:
            # Do not keep stock reserved by an order that can never be paid.
            orders_repo.cancel_order_release_inventory(self._store, order_id)
            raise ErrPaymentUnavailable from err
        if charge.client_token.strip():
            orders_repo.update_provider_ref(self._store, order_id, charge.client_token.strip())
            ord_row.provider_ref = charge.client_token.strip()
        view = self._to_view(ord_row, order_items)
        return view, charge

    def _payment_callback_url(self, order_id: str, inp: CreateOrderInput) -> str:
        explicit = inp.callback_url.strip()
        if explicit:
            return explicit
        path = (inp.return_path or "/").strip() or "/"
        if not path.startswith("/"):
            path = f"/{path}"
        q = urlencode({"velto_return": "1", "order": order_id})
        sep = "&" if "?" in path else "?"
        base = self._storefront_url or "http://localhost:5173"
        return f"{base.rstrip('/')}{path}{sep}{q}"

    def _resolve_provider(self, name: str, *, amount_minor: int) -> pt.Provider:
        """Resolve provider on ``OrdersService``."""
        if amount_minor == 0:
            free = self._payments.get(pt.PROVIDER_NAME_FREE)
            if free is None:
                raise ErrProviderRequired
            return free
        if not name:
            names = self._payments.names()
            if len(names) == 0:
                raise ErrProviderRequired
            if len(names) == 1:
                name = names[0]
            else:
                builtin = {pt.PROVIDER_NAME_MANUAL, pt.PROVIDER_NAME_FREE}
                paid = [n for n in names if n not in builtin]
                if len(paid) != 1:
                    raise ErrProviderRequired
                name = paid[0]
        p = self._payments.get(name)
        if p is None:
            raise ErrUnknownProvider
        return p

    def get(self, order_id: str) -> OrderView:
        """Get on ``OrdersService``."""
        ord_row = orders_repo.get_order_by_id(self._store, order_id)
        items = order_items_repo.list_order_items_for_order(self._store, order_id)
        return self._to_view(ord_row, items)

    def list_for_user(self, user_id: str) -> list[OrderView]:
        """List for user on ``OrdersService``."""
        rows = orders_repo.list_orders_for_user(self._store, user_id)
        return [self._to_view(r, None) for r in rows]

    def list_for_event(self, event_id: str) -> list[OrderView]:
        """List for event on ``OrdersService``."""
        rows = orders_repo.list_orders_for_event(self._store, event_id)
        return [self._to_view(r, None) for r in rows]

    def mark_failed(self, order_id: str) -> OrderView:
        """Mark failed on ``OrdersService``."""
        orders_repo.get_order_by_id(self._store, order_id)
        released = orders_repo.cancel_order_release_inventory(self._store, order_id)
        if not released:
            raise ErrOrderNotPending
        fresh = orders_repo.get_order_by_id(self._store, order_id)
        return self._to_view(fresh, None)

    def settle(self, result: pt.Result) -> tuple[OrderView, list[TicketView]]:
        """Settle on ``OrdersService``."""
        ord_row = orders_repo.get_order_by_id(self._store, result.reference)
        pt.reconcile(
            result,
            pt.OrderRef(id=ord_row.id, amount_minor=ord_row.total_minor, currency=ord_row.currency),
        )
        if ord_row.status == "paid":
            return self._already_settled(ord_row)
        if ord_row.status != "pending":
            raise ErrOrderNotSettleable
        items = order_items_repo.list_order_items_for_order(self._store, ord_row.id)
        paid_at = result.paid_at or datetime.now(timezone.utc)
        ev = events_repo.get_event_by_id(self._store, ord_row.event_id)
        # Valid from purchase through event end (scan at registration / 3B before starts_at).
        nbf = int(paid_at.timestamp())
        exp = int(ev.ends_at.timestamp())
        ref_year = paid_at.year

        def mint(conn) -> list[tickets_repo.Ticket]:
            out: list[tickets_repo.Ticket] = []
            drawn: set[str] = set()

            def mint_one(ticket_type_id: str) -> tickets_repo.Ticket:
                ref = pass_serial.next_pass_ref(self._store, conn, ref_year, drawn)
                tid = new_ulid()
                holder = reg.safe_holder_name(ord_row.buyer_name)
                payload = cap.Payload(
                    tid=tid,
                    ref=ref,
                    eid=ord_row.event_id,
                    tt=ticket_type_id,
                    sub=ord_row.user_id or "",
                    name=holder,
                    iat=int(paid_at.timestamp()),
                    nbf=nbf,
                    exp=exp,
                )
                token, _ = issue_mod.issue_ticket(self._store, ord_row.event_id, payload)
                return tickets_repo.Ticket(
                    id=tid,
                    order_id=ord_row.id,
                    event_id=ord_row.event_id,
                    ticket_type_id=ticket_type_id,
                    holder_user_id=ord_row.user_id,
                    holder_name=holder,
                    serial=ref,
                    capability=token,
                    status="valid",
                    issued_at=paid_at,
                )

            minted_types: set[str] = set()
            includes_vip = False
            for item in items:
                tt = tt_repo.get_ticket_type_by_id(self._store, item.ticket_type_id)
                kind = tt.product_kind or tt_repo.PRODUCT_KIND_TICKET
                if kind != tt_repo.PRODUCT_KIND_TICKET:
                    continue
                if tt.pass_tier == PASS_TIER_VIP:
                    includes_vip = True
                for _ in range(item.quantity):
                    out.append(mint_one(item.ticket_type_id))
                    minted_types.add(item.ticket_type_id)
            if includes_vip:
                student_tt = next(
                    (
                        t
                        for t in tt_repo.list_ticket_types_for_event(self._store, ord_row.event_id)
                        if t.pass_tier == PASS_TIER_STUDENT and t.status == "active"
                    ),
                    None,
                )
                if student_tt is not None and student_tt.id not in minted_types:
                    out.append(mint_one(student_tt.id))
            return out

        settled = orders_repo.settle_order(self._store, ord_row.id, paid_at, mint=mint)
        if not settled:
            fresh = orders_repo.get_order_by_id(self._store, ord_row.id)
            return self._already_settled(fresh)
        fresh = orders_repo.get_order_by_id(self._store, ord_row.id)
        view = self._to_view(fresh, None)
        minted = tickets_repo.list_tickets_for_order(self._store, ord_row.id)
        tickets = [self._ticket_view(t) for t in minted]
        if self._notify:
            self._notify.on_order_paid(ord_row.id)
        return view, tickets

    def _already_settled(self, ord_row: orders_repo.Order) -> tuple[OrderView, list[TicketView]]:
        """Already settled on ``OrdersService``."""
        existing = tickets_repo.list_tickets_for_order(self._store, ord_row.id)
        return self._to_view(ord_row, None), [self._ticket_view(t) for t in existing]

    def tickets_for_user(self, user_id: str) -> list[TicketView]:
        """Tickets for user on ``OrdersService``."""
        rows = tickets_repo.list_tickets_for_user(self._store, user_id)
        return [self._ticket_view(t) for t in rows]

    def ticket(self, ticket_id: str) -> TicketView:
        """Ticket on ``OrdersService``."""
        return self._ticket_view(tickets_repo.get_ticket_by_id(self._store, ticket_id))

    def tickets_for_order(self, order_id: str) -> list[TicketView]:
        """Tickets already minted for a paid order."""
        rows = tickets_repo.list_tickets_for_order(self._store, order_id)
        return [self._ticket_view(t) for t in rows]

    def _to_view(self, o: orders_repo.Order, items) -> OrderView:
        """To view on ``OrdersService``."""
        item_views = None
        if items is not None:
            item_views = [
                {
                    "id": it.id,
                    "ticket_type_id": it.ticket_type_id,
                    "quantity": it.quantity,
                    "unit_price_minor": it.unit_price_minor,
                }
                for it in items
            ]
        return OrderView(
            id=o.id,
            event_id=o.event_id,
            user_id=o.user_id or "",
            buyer_email=o.buyer_email,
            buyer_name=o.buyer_name,
            buyer_first_name=o.buyer_first_name,
            buyer_last_name=o.buyer_last_name,
            school_name=o.school_name,
            motivation=o.motivation,
            wish=o.wish,
            registration_form=reg.parse_form(getattr(o, "registration_form", None)),
            status=o.status,
            subtotal_minor=o.subtotal_minor,
            fee_minor=o.fee_minor,
            total_minor=o.total_minor,
            currency=o.currency,
            provider=o.provider,
            provider_ref=o.provider_ref or "",
            created_at=o.created_at,
            paid_at=o.paid_at,
            items=item_views,
        )

    def _ticket_view(self, t: tickets_repo.Ticket) -> TicketView:
        """Ticket view on ``OrdersService``."""
        return TicketView(
            id=t.id,
            order_id=t.order_id,
            event_id=t.event_id,
            ticket_type_id=t.ticket_type_id,
            holder_user_id=t.holder_user_id or "",
            holder_name=t.holder_name,
            serial=t.serial,
            capability=t.capability,
            status=t.status,
            issued_at=t.issued_at,
        )
