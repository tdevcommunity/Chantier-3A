"""Canonical buyer email for deduplication (plus-addressing, Gmail dots)."""

from __future__ import annotations

_GMAIL_DOMAINS = frozenset({"gmail.com", "googlemail.com"})


class InvalidEmail(ValueError):
    """Email format rejected before canonicalization."""


def canonical_email(email: str) -> str:
    """
    Normalize email for uniqueness checks and storage on orders.

    - trim + lower case
    - strip plus-tag from local part (user+tag@domain -> user@domain)
    - remove dots from Gmail / Googlemail local parts
    """
    raw = (email or "").strip()
    if not raw or "@" not in raw:
        raise InvalidEmail("invalid email address")
    local, _, domain = raw.partition("@")
    domain = domain.strip().lower()
    local = local.strip().lower()
    if not local or not domain or local.startswith(".") or domain.startswith("."):
        raise InvalidEmail("invalid email address")
    if "+" in local:
        local = local.split("+", 1)[0]
    if not local:
        raise InvalidEmail("invalid email address")
    if domain in _GMAIL_DOMAINS:
        local = local.replace(".", "")
    return f"{local}@{domain}"
