"""Festival pass tiers: catalog and defaults for ticket types.

Prices use the event currency. For FCFA (West Africa), set the event to ``XOF``:
``price_minor`` is whole francs (exponent 0), e.g. 5000 FCFA -> ``price_minor: 5000``.
"""

from __future__ import annotations

import re

PASS_TIER_STUDENT = "student"
PASS_TIER_STANDARD = "standard"
PASS_TIER_VIP = "vip"

ALL_PASS_TIERS = (PASS_TIER_STUDENT, PASS_TIER_STANDARD, PASS_TIER_VIP)

ENABLED_PASS_TIERS = ALL_PASS_TIERS

PASS_TIER_LABELS: dict[str, str] = {
    PASS_TIER_STUDENT: "Pass Festival",
    PASS_TIER_STANDARD: "Pass standard",
    PASS_TIER_VIP: "Pass Nexus Night",
}


def display_ticket_name(name: str) -> str:
    """Public label without parenthetical suffixes, e.g. '(Jour 1)'."""
    cleaned = re.sub(r"\s*\([^)]*\)", "", (name or "").strip()).strip()
    return cleaned or (name or "").strip() or "Pass"

PASS_TIER_PRICE_MINOR: dict[str, int] = {
    PASS_TIER_STUDENT: 0,
    PASS_TIER_STANDARD: 2000,
    PASS_TIER_VIP: 5000,
}

STUDENT_PASS_TICKET_TYPE_BODY: dict = {
    "name": PASS_TIER_LABELS[PASS_TIER_STUDENT],
    "description": "Accès gratuit aux deux jours du festival.",
    "price_minor": PASS_TIER_PRICE_MINOR[PASS_TIER_STUDENT],
    "quantity_total": 500,
    "max_per_order": 1,
    "status": "active",
    "sort_order": 0,
    "product_kind": "ticket",
    "pass_tier": PASS_TIER_STUDENT,
}

STANDARD_PASS_TICKET_TYPE_BODY: dict = {
    "name": PASS_TIER_LABELS[PASS_TIER_STANDARD],
    "description": "Accès complet aux deux jours du festival.",
    "price_minor": PASS_TIER_PRICE_MINOR[PASS_TIER_STANDARD],
    "quantity_total": 0,
    "max_per_order": 5,
    "status": "active",
    "sort_order": 1,
    "product_kind": "ticket",
    "pass_tier": PASS_TIER_STANDARD,
}

VIP_PASS_TICKET_TYPE_BODY: dict = {
    "name": PASS_TIER_LABELS[PASS_TIER_VIP],
    "description": "Soirée exclusive Nexus : gaming, cosplay, DJ set et projections.",
    "price_minor": PASS_TIER_PRICE_MINOR[PASS_TIER_VIP],
    "quantity_total": 0,
    "max_per_order": 5,
    "status": "active",
    "sort_order": 2,
    "product_kind": "ticket",
    "pass_tier": PASS_TIER_VIP,
}

DEFAULT_PASS_TICKET_TYPE_BODIES: dict[str, dict] = {
    PASS_TIER_STUDENT: STUDENT_PASS_TICKET_TYPE_BODY,
    PASS_TIER_STANDARD: STANDARD_PASS_TICKET_TYPE_BODY,
    PASS_TIER_VIP: VIP_PASS_TICKET_TYPE_BODY,
}


def pass_tier_catalog() -> list[dict]:
    """Tiers exposed to the storefront (enabled tiers only)."""
    out: list[dict] = []
    for tier in ENABLED_PASS_TIERS:
        entry: dict = {
            "id": tier,
            "label": PASS_TIER_LABELS[tier],
            "available": True,
            "price_minor": PASS_TIER_PRICE_MINOR[tier],
        }
        out.append(entry)
    return out


def normalize_pass_tier(value: object) -> str | None:
    """Return a known tier slug or None when absent/empty."""
    if value is None:
        return None
    tier = str(value).strip().lower()
    if not tier:
        return None
    return tier
