"""Envoi SMTP de l'e-mail d'accès staff."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from config import Config
from notify.staff_invite_email import StaffInviteEmailContext, build_staff_invite_email

log = logging.getLogger("chantier3a.notify.staff_invite")


def send_staff_invite_email(config: Config, ctx: StaffInviteEmailContext) -> None:
    """Deliver staff access instructions to the invited e-mail address."""
    if not config.smtp_host or not config.smtp_from:
        log.info("staff_invite: SMTP not configured; skipping e-mail to %s", ctx.invited_email)
        return

    to_addr = ctx.invited_email.strip()
    if not to_addr:
        return

    subject, plain, html = build_staff_invite_email(ctx)

    msg = EmailMessage()
    msg["From"] = config.smtp_from
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")

    with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=30) as smtp:
        if config.smtp_user:
            smtp.starttls()
            smtp.login(config.smtp_user, config.smtp_password)
        smtp.send_message(msg)
    log.info("staff_invite: sent access e-mail to %s", to_addr)
