"""Tests du modèle e-mail d'accès staff."""

from notify.staff_invite_email import StaffInviteEmailContext, build_staff_invite_email


def test_build_staff_invite_email_scanner_mobile_includes_default_password():
    ctx = StaffInviteEmailContext(
        org_name="Tdev Festival",
        role="scanner",
        login_url="https://festival.example/admin/scanner",
        invited_email="scanner@example.com",
        account_created=True,
        default_password="Tfestiv2026",
        contact_url="https://festival.example/contact",
        mobile_scanner=True,
    )
    subject, plain, html = build_staff_invite_email(ctx)

    assert "mobile" in subject.lower()
    assert "scanner@example.com" in plain
    assert "Tfestiv2026" in plain
    assert "téléphone" in plain.lower()
    assert "/admin/scanner" in plain

    assert "Tfestiv2026" in html
    assert "Ouvrir le scanner sur mobile" in html
    assert "Contactez l'équipe T-Dev" in html


def test_build_staff_invite_email_admin_web_login():
    ctx = StaffInviteEmailContext(
        org_name="Org",
        role="admin",
        login_url="https://festival.example/acces-equipe",
        invited_email="admin@example.com",
        account_created=True,
        default_password="Tfestiv2026",
        mobile_scanner=False,
    )
    subject, plain, html = build_staff_invite_email(ctx)
    assert "organisateur" in subject.lower()
    assert "Se connecter" in html
    assert "tableau de bord" in plain


def test_build_staff_invite_email_existing_account_omits_default_password():
    ctx = StaffInviteEmailContext(
        org_name="Org",
        role="admin",
        login_url="https://festival.example/acces-equipe",
        invited_email="admin@example.com",
        account_created=False,
        mobile_scanner=False,
    )
    _subject, plain, html = build_staff_invite_email(ctx)

    assert "Tfestiv2026" not in plain
    assert "compte existant" in plain.lower() or "compte Tdev Festival existant" in plain
    assert "Tfestiv2026" not in html
