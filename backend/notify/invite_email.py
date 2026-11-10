"""SMTP invitation for org staff members."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from config import Config

log = logging.getLogger("chantier3a.notify.invite")

ROLE_LABELS = {
    "owner": "Super Admin",
    "admin": "Administrateur",
    "scanner": "Scanner",
}


def send_org_invite_email(
    config: Config,
    *,
    to_email: str,
    org_name: str,
    role: str,
    accept_url: str,
    expires_days: int = 7,
) -> bool:
    """Send staff invite link. Returns False if SMTP is not configured."""
    if not config.smtp_host or not config.smtp_from:
        log.info("invite: smtp not configured, skip email to %s", to_email)
        return False
    role_label = ROLE_LABELS.get(role, role)
    org = org_name.strip() or "TDEV Festival"
    subject = f"Invitation équipe {org}"
    plain = (
        f"Bonjour,\n\n"
        f"Vous êtes invité(e) à rejoindre l'équipe {org} en tant que {role_label}.\n\n"
        f"Acceptez l'invitation (lien valide {expires_days} jours) :\n{accept_url}\n\n"
        f"Si vous n'avez pas encore de compte, le lien vous guidera pour en créer un.\n"
    )
    html = f"""\
<p>Bonjour,</p>
<p>Vous êtes invité(e) à rejoindre l'équipe <strong>{org}</strong> en tant que <strong>{role_label}</strong>.</p>
<p><a href="{accept_url}">Accepter l'invitation</a> (lien valide {expires_days} jours)</p>
<p>Si vous n'avez pas encore de compte, le lien vous guidera pour en créer un.</p>
"""
    msg = EmailMessage()
    msg["From"] = config.smtp_from
    msg["To"] = to_email.strip().lower()
    msg["Subject"] = subject
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=30) as smtp:
            if config.smtp_user:
                smtp.starttls()
                smtp.login(config.smtp_user, config.smtp_password)
            smtp.send_message(msg)
        log.info("invite: delivered to %s role=%s", to_email, role)
        return True
    except Exception:
        log.exception("invite: smtp failed for %s", to_email)
        return False
