"""Validation of the TDEV Festival 2026 participant form (PDF V1)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from auth.email_canonical import InvalidEmail as CanonInvalidEmail
from auth.email_canonical import canonical_email
from events.passes import PASS_TIER_STUDENT, PASS_TIER_VIP
from store import ticket_types as tt_repo

MAX_NAME = 120
MAX_SCHOOL = 200
MAX_TEXT = 4000
MAX_PHONE = 40
MAX_CITY = 120

AGE_RANGES = ("under_18", "18_24", "25_34", "35_plus")
GENDERS = ("woman", "man", "prefer_not", "other")
SITUATIONS = (
    "student",
    "developer",
    "entrepreneur",
    "digital_pro",
    "other_pro",
    "researcher",
    "job_seeker",
    "content_creator",
    "other",
)
DIGITAL_LEVELS = ("beginner", "learning", "intermediate", "experienced", "expert")
PARTICIPATION_REASONS = (
    "learn_skills",
    "discover_digital",
    "understand_ai",
    "meet_professionals",
    "grow_network",
    "find_opportunities",
    "present_projects",
    "exchange_with_peers",
    "other",
)
TOPICS = (
    "ai",
    "software",
    "cybersecurity",
    "data",
    "cloud",
    "open_source",
    "entrepreneurship",
    "fintech",
    "web_mobile",
    "digital_transformation",
    "jobs",
    "ai_society",
    "other",
)
PRIOR_PARTICIPATION = ("yes_2024", "yes_other", "first_time")
DISCOVERY_CHANNELS = (
    "facebook",
    "linkedin",
    "instagram",
    "whatsapp",
    "x",
    "telegram",
    "website",
    "friend",
    "tech_community",
    "school",
    "company",
    "other",
)
PREFERRED_CHANNELS = ("whatsapp", "email", "telegram", "other")


@dataclass
class PassRegistration:
    """Normalized checkout identity (legacy columns)."""

    first_name: str
    last_name: str
    email: str
    school_name: str
    motivation: str
    wish: str
    form: dict[str, Any] = field(default_factory=dict)


class RegistrationError(ValueError):
    """User-facing registration validation error (French message)."""


def order_needs_pass_registration(store, event_id: str, ticket_type_ids: list[str]) -> bool:
    """True if any line is a festival pass (gratuit or Nexus) that requires the PDF form."""
    for tt_id in ticket_type_ids:
        tt = tt_repo.get_ticket_type_by_id(store, tt_id)
        if tt.event_id != event_id:
            continue
        if tt.pass_tier in (PASS_TIER_STUDENT, PASS_TIER_VIP):
            return True
    return False


def parse_form(raw: Any) -> dict[str, Any]:
    """Parse stored JSON (text or dict) into a dict."""
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    try:
        data = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def dump_form(form: dict[str, Any] | None) -> str:
    """Serialize the participant form for the orders.registration_form column."""
    return json.dumps(form or {}, ensure_ascii=False, separators=(",", ":"))


def normalize_registration(
    *,
    email: str,
    first_name: str = "",
    last_name: str = "",
    legacy_name: str = "",
    school_name: str = "",
    motivation: str = "",
    wish: str = "",
    form: dict[str, Any] | None = None,
    required: bool,
) -> PassRegistration:
    """Validate registration. When ``required``, the PDF form is mandatory."""
    form_in = form if isinstance(form, dict) else {}
    if required or form_in:
        return normalize_full_form(
            form_in,
            email=email,
            first_name=first_name,
            last_name=last_name,
            legacy_name=legacy_name,
            school_name=school_name,
            motivation=motivation,
            wish=wish,
            required=required,
        )

    try:
        email = canonical_email(email)
    except CanonInvalidEmail as exc:
        raise RegistrationError("Adresse e-mail invalide.") from exc
    first_name = first_name.strip()
    last_name = last_name.strip()
    legacy_name = legacy_name.strip()
    if not first_name and not last_name and legacy_name:
        parts = legacy_name.split(None, 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else ""
    return PassRegistration(
        first_name=first_name,
        last_name=last_name,
        email=email,
        school_name=school_name.strip(),
        motivation=motivation.strip(),
        wish=wish.strip(),
        form={},
    )


def normalize_full_form(
    form: dict[str, Any],
    *,
    email: str = "",
    first_name: str = "",
    last_name: str = "",
    legacy_name: str = "",
    school_name: str = "",
    motivation: str = "",
    wish: str = "",
    required: bool,
) -> PassRegistration:
    """Validate the official participant form and map it onto legacy columns."""
    cleaned: dict[str, Any] = {}
    missing: list[str] = []

    cleaned["last_name"] = _str(form.get("last_name") or last_name)
    cleaned["first_name"] = _str(form.get("first_name") or first_name)
    if not cleaned["first_name"] and not cleaned["last_name"] and legacy_name.strip():
        parts = legacy_name.strip().split(None, 1)
        cleaned["first_name"] = parts[0]
        cleaned["last_name"] = parts[1] if len(parts) > 1 else ""

    cleaned["age_range"] = _choice(form.get("age_range"), AGE_RANGES)
    gender = _str(form.get("gender"))
    cleaned["gender"] = gender if gender in GENDERS else ""
    cleaned["country"] = _str(form.get("country"))
    cleaned["city"] = _str(form.get("city"))
    cleaned["phone"] = _str(form.get("phone"))
    raw_email = _str(form.get("email") or email)
    try:
        cleaned["email"] = canonical_email(raw_email) if raw_email else ""
    except CanonInvalidEmail as exc:
        raise RegistrationError("Adresse e-mail invalide.") from exc
    cleaned["situation"] = _choice(form.get("situation"), SITUATIONS)
    cleaned["activity_domain"] = _str(form.get("activity_domain"))
    cleaned["school_program"] = _str(form.get("school_program") or school_name)
    cleaned["digital_level"] = _choice(form.get("digital_level"), DIGITAL_LEVELS)
    cleaned["participation_reasons"] = _multi(form.get("participation_reasons"), PARTICIPATION_REASONS)
    cleaned["topics"] = _multi(form.get("topics"), TOPICS)
    cleaned["expectations"] = _str(form.get("expectations") or wish)
    cleaned["prior_participation"] = _choice(form.get("prior_participation"), PRIOR_PARTICIPATION)
    cleaned["prior_liked"] = _str(form.get("prior_liked"))
    cleaned["want_to_meet"] = _str(form.get("want_to_meet"))
    cleaned["discovery_channel"] = _choice(form.get("discovery_channel"), DISCOVERY_CHANNELS)
    cleaned["referred_by"] = _str(form.get("referred_by"))
    stay = form.get("stay_informed")
    cleaned["stay_informed"] = True if stay is True or stay == "yes" else False if stay is False or stay == "no" else None
    cleaned["preferred_channel"] = _choice(form.get("preferred_channel"), PREFERRED_CHANNELS)
    cleaned["consent_data_processing"] = bool(form.get("consent_data_processing"))
    cleaned["consent_marketing"] = bool(form.get("consent_marketing"))

    if required:
        if not cleaned["last_name"]:
            missing.append("le nom")
        if not cleaned["first_name"]:
            missing.append("le prénom")
        if not cleaned["age_range"]:
            missing.append("la tranche d'âge")
        if not cleaned["country"]:
            missing.append("le pays de résidence")
        if not cleaned["city"]:
            missing.append("la ville de résidence")
        if not cleaned["phone"]:
            missing.append("le numéro de téléphone")
        if not cleaned["email"] or "@" not in cleaned["email"]:
            missing.append("l'adresse e-mail")
        if not cleaned["situation"]:
            missing.append("votre situation actuelle")
        if not cleaned["activity_domain"]:
            missing.append("le domaine d'activité")
        if not cleaned["digital_level"]:
            missing.append("votre niveau numérique")
        if not cleaned["participation_reasons"]:
            missing.append("les raisons de participation")
        if not cleaned["topics"]:
            missing.append("les sujets d'intérêt")
        if not cleaned["expectations"]:
            missing.append("vos attentes")
        if not cleaned["prior_participation"]:
            missing.append("votre participation aux éditions précédentes")
        if not cleaned["discovery_channel"]:
            missing.append("comment vous avez connu le festival")
        if cleaned["stay_informed"] is None:
            missing.append("votre choix d'informations")
        if cleaned["stay_informed"] and not cleaned["preferred_channel"]:
            missing.append("le canal de communication préféré")
        if not cleaned["consent_data_processing"]:
            missing.append("l'acceptation d'utilisation des données")
        if missing:
            raise RegistrationError(
                "Formulaire incomplet. Merci de renseigner : " + ", ".join(missing) + "."
            )

    _check_len("nom", cleaned["last_name"], MAX_NAME)
    _check_len("prénom", cleaned["first_name"], MAX_NAME)
    _check_len("ville", cleaned["city"], MAX_CITY)
    _check_len("téléphone", cleaned["phone"], MAX_PHONE)
    _check_len("établissement", cleaned["school_program"], MAX_SCHOOL)
    _check_len("attentes", cleaned["expectations"], MAX_TEXT)
    _check_len("expérience", cleaned["prior_liked"], MAX_TEXT)

    reasons = cleaned["participation_reasons"]
    motivation_legacy = motivation.strip() or ", ".join(reasons)
    wish_legacy = cleaned["expectations"] or wish.strip()
    school_legacy = cleaned["school_program"] or school_name.strip()

    return PassRegistration(
        first_name=cleaned["first_name"],
        last_name=cleaned["last_name"],
        email=cleaned["email"],
        school_name=school_legacy,
        motivation=motivation_legacy,
        wish=wish_legacy,
        form=cleaned,
    )


def safe_holder_name(name: str) -> str:
    """Name embedded in ticket capability tokens (no markup)."""
    cleaned = _sanitize_plain_text(name)
    return (cleaned[:MAX_NAME] if cleaned else "Participant")


def _sanitize_plain_text(value: str) -> str:
    """Reject markup and control chars in user-provided text fields."""
    cleaned = value.replace("\x00", "").replace("<", "").replace(">", "")
    return cleaned.strip()


def _str(value: Any) -> str:
    if value is None:
        return ""
    return _sanitize_plain_text(str(value))


def _choice(value: Any, allowed: tuple[str, ...]) -> str:
    raw = _str(value)
    return raw if raw in allowed else ""


def _multi(value: Any, allowed: tuple[str, ...]) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = [v.strip() for v in value.split(",") if v.strip()]
    elif isinstance(value, (list, tuple, set)):
        items = [_str(v) for v in value]
    else:
        return []
    return [item for item in items if item in allowed]


def _check_len(field: str, value: str, limit: int) -> None:
    if len(value) > limit:
        raise RegistrationError(f"{field} dépasse {limit} caractères.")
