"""Stored registration fields must not retain HTML/script payloads."""

from __future__ import annotations

from orders.registration import normalize_full_form


def test_sanitize_strips_markup_from_text_fields():
    form = {
        "last_name": '"><img src=x onerror=alert(1)>',
        "first_name": "Ada",
        "age_range": "18_24",
        "country": "TG",
        "city": "Lome",
        "phone": "90000000",
        "email": "x@example.com",
        "situation": "student",
        "activity_domain": "IT",
        "digital_level": "learning",
        "participation_reasons": ["learn_skills"],
        "topics": ["ai"],
        "expectations": "<script>alert(1)</script>",
        "prior_participation": "first_time",
        "discovery_channel": "school",
        "stay_informed": False,
        "consent_data_processing": True,
    }
    reg = normalize_full_form(form, required=True)
    assert "<" not in reg.first_name
    assert "<" not in reg.last_name
    assert "<" not in reg.wish
    assert "<" not in reg.wish
    assert ">" not in reg.wish
