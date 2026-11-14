"""Shared payment provider types, statuses, and capability flags."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Protocol


class Status(str, Enum):
    """Status."""
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"


class Flow(str, Enum):
    """Flow."""
    REDIRECT = "redirect"
    INLINE = "inline"
    MANUAL = "manual"
    INVOICE = "invoice"


@dataclass
class Capabilities:
    """Capabilities."""
    currencies: list[str] | None = None
    countries: list[str] | None = None
    flow: Flow = Flow.MANUAL
    refunds: bool = False
    payouts: bool = False
    webhooks: bool = False
    zero_decimal_ok: bool = True

    def supports_currency(self, code: str) -> bool:
        """Supports currency on ``Capabilities``."""
        if not self.currencies:
            return True
        code = code.strip().upper()
        return any(c.upper() == code for c in self.currencies)


@dataclass
class Order:
    """Order."""
    reference: str
    event_id: str = ""
    org_id: str = ""
    buyer_email: str = ""
    buyer_name: str = ""
    amount_minor: int = 0
    currency: str = ""
    callback_url: str = ""
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class Charge:
    """Charge."""
    provider: str
    reference: str
    redirect_url: str = ""
    instructions: str = ""
    client_token: str = ""


@dataclass
class Result:
    """Result."""
    provider: str
    reference: str
    event_id: str = ""
    status: Status = Status.PENDING
    amount_minor: int = 0
    currency: str = ""
    paid_at: datetime | None = None
    raw: Any = None


@dataclass
class OrderRef:
    """Orderref."""
    id: str
    amount_minor: int
    currency: str


class Provider(Protocol):
    """Provider."""
    def name(self) -> str: ...

    def capabilities(self) -> Capabilities: ...

    def begin(self, order: Order) -> Charge: ...

    def verify(self, reference: str) -> Result: ...

    def webhook(self, body: bytes, headers: dict[str, str]) -> Result: ...


PROVIDER_NAME_MANUAL = "manual"
PROVIDER_NAME_MANUAL_MOMO = "manual_momo"
PROVIDER_NAME_STUB = "stub"
PROVIDER_NAME_FREE = "free"

ErrReferenceMismatch = Exception("payments: reference does not match order")
ErrAmountMismatch = Exception("payments: settled amount does not match order total")
ErrCurrencyMismatch = Exception("payments: settled currency does not match order currency")
ErrNotPaid = Exception("payments: provider result is not a settled payment")
ErrReplayed = Exception("payments: webhook event already processed (replay)")
ErrUnhandledEvent = Exception("payments: unhandled webhook event type")


def reconcile(result: Result, want: OrderRef) -> None:
    """Reconcile."""
    if not result.reference or result.reference != want.id:
        raise ErrReferenceMismatch
    if result.status != Status.PAID:
        raise ErrNotPaid
    # FedaPay peut faire payer des frais en plus au client : le montant API peut dépasser le total commande.
    if result.amount_minor < want.amount_minor:
        raise ErrAmountMismatch
    if result.currency.upper() != want.currency.upper():
        raise ErrCurrencyMismatch
