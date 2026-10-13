"""Canonical email for order deduplication."""

from __future__ import annotations

import pytest

from auth.email_canonical import InvalidEmail, canonical_email


def test_canonical_lowercase_and_trim():
    assert canonical_email("  User@Example.COM ") == "user@example.com"


def test_canonical_strips_plus_tag():
    assert canonical_email("pentest-sec+1@example.com") == "pentest-sec@example.com"
    assert canonical_email("a+b+c@mail.org") == "a@mail.org"


def test_canonical_gmail_dots():
    assert canonical_email("first.last@gmail.com") == "firstlast@gmail.com"
    assert canonical_email("first.last@googlemail.com") == "firstlast@googlemail.com"


def test_canonical_invalid():
    with pytest.raises(InvalidEmail):
        canonical_email("")
    with pytest.raises(InvalidEmail):
        canonical_email("@nodomain.com")
