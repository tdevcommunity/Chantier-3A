"""Web scanner helpers: pass serial normalization, lookup, and name search."""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

_SERIAL_SUFFIX_RE = re.compile(r"^\d{1,4}$")
_SERIAL_FULL_RE = re.compile(r"^TDEV-\d{4}-\d{4}$", re.IGNORECASE)


def mask_email(email: str) -> str:
    """Return a privacy-safe display e-mail (e.g. a***@gmail.com)."""
    addr = (email or "").strip()
    if "@" not in addr:
        return ""
    local, domain = addr.split("@", 1)
    if not local:
        return f"***@{domain}"
    shown = local[0]
    return f"{shown}***@{domain}"


def normalize_pass_serial(
    *,
    serial: str = "",
    serial_suffix: str = "",
    year: int = 2026,
) -> str | None:
    """Build canonical TDEV-YYYY-NNNN from suffix or validate full serial."""
    full = (serial or "").strip().upper()
    if full:
        if _SERIAL_FULL_RE.match(full):
            return full
        return None
    suffix = (serial_suffix or "").strip()
    if not _SERIAL_SUFFIX_RE.match(suffix):
        return None
    return f"TDEV-{year}-{int(suffix):04d}"


def _fold(text: str) -> str:
    raw = unicodedata.normalize("NFD", (text or "").strip().lower())
    return "".join(ch for ch in raw if unicodedata.category(ch) != "Mn")


def _haystack(row: dict[str, Any]) -> str:
    parts = [
        row.get("holder_name") or "",
        row.get("buyer_first_name") or "",
        row.get("buyer_last_name") or "",
        f"{row.get('buyer_first_name') or ''} {row.get('buyer_last_name') or ''}",
        row.get("buyer_email") or "",
    ]
    return _fold(" ".join(parts))


def name_query_matches(row: dict[str, Any], query: str) -> bool:
    """Case- and accent-insensitive substring match on participant fields."""
    q = _fold(query)
    if len(q) < 3:
        return False
    hay = _haystack(row)
    tokens = [t for t in q.split() if t]
    if not tokens:
        return False
    return all(t in hay for t in tokens)


def parse_registration_form(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def preview_from_ticket_row(row: dict[str, Any], *, admitted: bool) -> dict[str, Any]:
    holder = (row.get("holder_name") or "").strip()
    first = (row.get("buyer_first_name") or "").strip()
    last = (row.get("buyer_last_name") or "").strip()
    display = holder or f"{first} {last}".strip()
    email = (row.get("buyer_email") or "").strip()
    pass_label = row.get("pass_tier") or row.get("ticket_type_name") or "Pass"
    return {
        "ticket_id": row["id"],
        "serial": row.get("serial") or "",
        "holder_name": display,
        "pass_label": pass_label,
        "email_masked": mask_email(email),
        "status": row.get("status") or "",
        "admitted": admitted,
    }