"""Manual Mobile Money payment: merchant numbers and operator withdrawal fees.

The customer transfers to a merchant number, then declares the transfer
reference. Withdrawal fees (charged by the operator when the merchant cashes
out) are added to the customer's total, except for Xpress which has none.

Fee grids are the ones used by apecol-familles (``src/lib/fees.ts``).
All amounts are minor units (XOF has no subunit, so 1 minor == 1 XOF).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from payments import types as pt

PROVIDER_NAME_MANUAL_MOMO = pt.PROVIDER_NAME_MANUAL_MOMO

OPERATOR_XPRESS = "xpress"
OPERATOR_MIXX = "mixx_by_yas"
OPERATOR_MOOV = "moov_money"

MIN_REFERENCE_LENGTH = 6
MAX_REFERENCE_LENGTH = 40


@dataclass(frozen=True)
class Operator:
    """A Mobile Money operator the customer can pay with."""

    code: str
    label: str
    env_var: str
    default_number: str


OPERATORS: tuple[Operator, ...] = (
    Operator(OPERATOR_XPRESS, "Xpress", "CHANTIER3A_MERCHANT_XPRESS", "140983480002"),
    Operator(OPERATOR_MIXX, "Mixx By Yas", "CHANTIER3A_MERCHANT_MIXX", "92451589"),
    Operator(OPERATOR_MOOV, "Moov Money", "CHANTIER3A_MERCHANT_MOOV", "79645440"),
)

_BY_CODE = {op.code: op for op in OPERATORS}

# (max amount, withdrawal fee) -- first tranche whose max >= amount applies.
_MIXX_TRANCHES: tuple[tuple[int, int], ...] = (
    (500, 50),
    (5_000, 100),
    (20_000, 300),
    (50_000, 600),
    (100_000, 1_000),
    (200_000, 3_100),
    (300_000, 3_700),
    (500_000, 4_200),
)

_MOOV_TRANCHES: tuple[tuple[int, int], ...] = (
    (500, 50),
    (1_000, 75),
    (5_000, 100),
    (15_000, 280),
    (20_000, 320),
    (50_000, 600),
    (100_000, 1_000),
    (200_000, 3_100),
    (300_000, 3_700),
    (500_000, 4_200),
)


class ManualMomoError(ValueError):
    """Invalid manual payment declaration."""


def is_valid_operator(code: str) -> bool:
    """True if ``code`` is a supported operator."""
    return code in _BY_CODE


def merchant_number(code: str) -> str:
    """Merchant number for an operator (env override, else built-in default)."""
    op = _BY_CODE[code]
    return (os.environ.get(op.env_var, "") or "").strip() or op.default_number


def _tranche_fee(tranches: tuple[tuple[int, int], ...], amount_minor: int) -> int:
    for max_amount, fee in tranches:
        if amount_minor <= max_amount:
            return fee
    return tranches[-1][1]


def withdrawal_fee(operator: str, amount_minor: int) -> int:
    """Withdrawal fee added to the customer's total for ``operator``."""
    if not is_valid_operator(operator):
        raise ManualMomoError("Opérateur de paiement invalide.")
    if amount_minor <= 0 or operator == OPERATOR_XPRESS:
        return 0
    if operator == OPERATOR_MIXX:
        return _tranche_fee(_MIXX_TRANCHES, amount_minor)
    return _tranche_fee(_MOOV_TRANCHES, amount_minor)


def normalize_reference(raw: str) -> str:
    """Trim, strip unsafe characters and upper-case a transfer reference."""
    cleaned = re.sub(r"[^A-Za-z0-9-]", "", (raw or "").strip()).upper()
    return cleaned[:MAX_REFERENCE_LENGTH]


def normalize_phone(raw: str) -> str:
    """Keep digits and a leading '+' of the sender number."""
    s = (raw or "").strip()
    plus = "+" if s.startswith("+") else ""
    digits = re.sub(r"\D", "", s)
    return f"{plus}{digits}"


def validate_declaration(operator: str, reference: str, phone: str) -> tuple[str, str, str]:
    """Validate and normalize (operator, reference, phone); raise ``ManualMomoError``."""
    op = (operator or "").strip()
    if not is_valid_operator(op):
        raise ManualMomoError("Choisissez un opérateur de paiement.")
    ref = normalize_reference(reference)
    if len(ref) < MIN_REFERENCE_LENGTH:
        raise ManualMomoError(
            f"Référence de paiement manquante ou trop courte (minimum {MIN_REFERENCE_LENGTH} caractères)."
        )
    ph = normalize_phone(phone)
    if len(re.sub(r"\D", "", ph)) < 8:
        raise ManualMomoError("Numéro émetteur invalide.")
    return op, ref, ph


class ManualMomoProvider:
    """No external call: the customer pays a merchant number, staff validate by hand.

    Settlement goes through ``OrdersService.validate_manual`` (never a webhook).
    """

    def name(self) -> str:
        """Provider name."""
        return PROVIDER_NAME_MANUAL_MOMO

    def capabilities(self) -> pt.Capabilities:
        """Manual flow, no webhooks."""
        return pt.Capabilities(flow=pt.Flow.MANUAL, webhooks=False)

    def begin(self, order: pt.Order) -> pt.Charge:
        """Nothing to start remotely; the declaration is stored with the order."""
        if not order.reference.strip():
            raise ValueError("order id is required")
        if order.amount_minor <= 0:
            raise ValueError("amount must be positive")
        return pt.Charge(
            provider=self.name(),
            reference=order.reference.strip(),
            instructions="En attente de vérification de votre paiement par l'équipe.",
        )

    def verify(self, reference: str) -> pt.Result:
        """Manual payments are never confirmed by polling."""
        raise ValueError("manual_momo payments are validated by staff")

    def webhook(self, body: bytes, headers: dict[str, str]) -> pt.Result:
        """No webhooks."""
        raise ValueError("manual_momo provider does not accept webhooks")


def options_payload(amount_minor: int) -> dict:
    """Public payload: operators, merchant numbers and fee/total for ``amount_minor``."""
    return {
        "amount_minor": amount_minor,
        "operators": [
            {
                "code": op.code,
                "label": op.label,
                "merchant_number": merchant_number(op.code),
                "fee_minor": withdrawal_fee(op.code, amount_minor),
                "total_minor": amount_minor + withdrawal_fee(op.code, amount_minor),
            }
            for op in OPERATORS
        ],
        "min_reference_length": MIN_REFERENCE_LENGTH,
    }
