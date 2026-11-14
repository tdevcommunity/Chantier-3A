"""Best-effort SMTP notifications after order payment (optional)."""

from __future__ import annotations

import logging
import smtplib
import threading
from urllib.parse import quote
from email.message import EmailMessage

from config import Config
from events.festival_schedule import format_event_when_label
from notify.ticket_email import (
    DEFAULT_GOODIES_SHOP_URL,
    TicketEmailContext,
    TicketEmailLine,
    TicketEmailVariant,
    build_ticket_email,
)
from events.passes import PASS_TIER_VIP
from notify.ticket_image import TicketImageInput, render_pass_ticket_pdf
from store import events_repo, orders as orders_repo
from store.store import Store

log = logging.getLogger("chantier3a.notify")


def _venue_line(venue: str, address: str) -> str:
    parts = [venue.strip(), address.strip()]
    joined = ", ".join(p for p in parts if p)
    return joined or "Lieu à confirmer"


def _email_variant_for_order(store: Store, ticket_rows) -> TicketEmailVariant:
    """Nexus Night utilise le template dédié ; le pass festival gratuit ou standard utilise l'autre."""
    for ticket in ticket_rows:
        row = store.fetchone(
            "SELECT pass_tier, name FROM ticket_types WHERE id = ?",
            (ticket.ticket_type_id,),
        )
        tier = ""
        name = ""
        if row is not None:
            if hasattr(row, "keys"):
                tier = str(row["pass_tier"] or "")
                name = str(row["name"] or "")
            else:
                tier = str(row[0] or "")
                name = str(row[1] or "") if len(row) > 1 else ""
        if tier == PASS_TIER_VIP:
            return "nexus"
        label = name.lower()
        if "nexus" in label or "vip" in label:
            return "nexus"
    return "festival"


class NotifyService:
    """Background SMTP queue: one confirmation e-mail per paid order when SMTP is configured."""

    def __init__(self, store: Store, config: Config) -> None:
        """Initialize ``NotifyService``."""
        self._store = store
        self._config = config
        self._sent_orders: set[str] = set()
        self._lock = threading.Lock()

    def on_order_paid(self, order_id: str) -> None:
        """On order paid on ``NotifyService``."""
        with self._lock:
            if order_id in self._sent_orders:
                return
            self._sent_orders.add(order_id)
        threading.Thread(target=self._send_confirmation, args=(order_id,), daemon=True).start()

    def resend_order_confirmation(self, order_id: str) -> None:
        """Staff-triggered re-send of the ticket e-mail (ignores the paid-order dedup cache)."""
        threading.Thread(target=self._send_confirmation, args=(order_id,), daemon=True).start()

    def on_order_rejected(self, order_id: str) -> None:
        """Tell the buyer their manual payment was rejected (staff-provided reason)."""
        threading.Thread(target=self._send_rejection, args=(order_id,), daemon=True).start()

    def _send_rejection(self, order_id: str) -> None:
        """Send the rejection e-mail with the reason so the buyer can submit a new declaration."""
        try:
            ord_row = orders_repo.get_order_by_id(self._store, order_id)
            ev = events_repo.get_event_by_id(self._store, ord_row.event_id)
        except Exception as err:
            log.error("notify: load order/event for rejection: %s", err)
            return
        if not self._config.smtp_host or not self._config.smtp_from:
            log.info("notify: SMTP not configured; skipping rejection e-mail for order %s", order_id)
            return
        name = ord_row.buyer_first_name or ord_row.buyer_name or ""
        reason = ord_row.rejection_reason or "Paiement non retrouvé."
        ref = ord_row.manual_payment_ref or ""
        subject = f"Votre paiement n'a pas pu être validé — {ev.title}"
        plain = (
            f"Bonjour {name},\n\n"
            f"Nous n'avons pas pu valider votre paiement (référence déclarée : {ref}) "
            f"pour {ev.title}.\n\n"
            f"Motif : {reason}\n\n"
            "Votre place n'est pas réservée. Vous pouvez refaire votre inscription et "
            "déclarer à nouveau votre paiement avec la bonne référence.\n"
        )
        from html import escape

        html = (
            f"<p>Bonjour {escape(name)},</p>"
            f"<p>Nous n'avons pas pu valider votre paiement (référence déclarée : "
            f"<strong>{escape(ref)}</strong>) pour <strong>{escape(ev.title)}</strong>.</p>"
            f"<p><strong>Motif :</strong> {escape(reason)}</p>"
            "<p>Votre place n'est pas réservée. Vous pouvez refaire votre inscription et "
            "déclarer à nouveau votre paiement avec la bonne référence.</p>"
        )
        try:
            self._send_smtp(ord_row.buyer_email, subject, plain, html)
        except Exception as err:
            log.error("notify: rejection send failed order=%s err=%s", order_id, err)

    def _send_confirmation(self, order_id: str) -> None:
        """Send confirmation on ``NotifyService``."""
        try:
            ord_row = orders_repo.get_order_by_id(self._store, order_id)
            ev = events_repo.get_event_by_id(self._store, ord_row.event_id)
        except Exception as err:
            log.error("notify: load order/event: %s", err)
            return
        if not self._config.smtp_host or not self._config.smtp_from:
            log.info("notify: SMTP not configured; skipping e-mail for order %s", order_id)
            return
        from store import tickets as tickets_repo

        base = self._config.base_url.rstrip("/")
        # The web app has no ticket page; link straight to the guest PDF download endpoint.
        billet_url = f"{base}/api/orders/{ord_row.id}/guest/ticket.pdf?email={quote(ord_row.buyer_email, safe='')}"
        ticket_rows = tickets_repo.list_tickets_for_order(self._store, order_id)

        holder = f"{getattr(ord_row, 'buyer_first_name', '')} {getattr(ord_row, 'buyer_last_name', '')}".strip()
        if not holder:
            holder = ord_row.buyer_name

        when_label = format_event_when_label(
            ev.starts_at.isoformat().replace("+00:00", "Z"),
            ends_at_iso=ev.ends_at.isoformat().replace("+00:00", "Z"),
            tz_name=ev.timezone or None,
        )
        venue = _venue_line(ev.venue_name or "", ev.address or "")

        pdf_attachments: list[tuple[str, bytes]] = []
        mail_lines: list[TicketEmailLine] = []
        for t in ticket_rows:
            if not t.capability:
                continue
            tt_name = ""
            row = self._store.fetchone("SELECT name FROM ticket_types WHERE id = ?", (t.ticket_type_id,))
            if row is not None:
                tt_name = row["name"] if hasattr(row, "keys") else row[0]
            from events.passes import display_ticket_name

            pass_label = display_ticket_name(tt_name) if tt_name else "Pass"
            holder_name = t.holder_name or holder
            mail_lines.append(
                TicketEmailLine(
                    pass_label=pass_label,
                    holder_name=holder_name,
                    serial=t.serial,
                )
            )
            pdf = render_pass_ticket_pdf(
                TicketImageInput(
                    event_title=ev.title,
                    pass_label=pass_label,
                    holder_name=holder_name,
                    when_label=when_label,
                    venue_line=venue,
                    serial=t.serial,
                    capability=t.capability,
                )
            )
            pdf_attachments.append((f"billet-{t.serial}.pdf", pdf))

        contact_url = f"{base}/contact" if base else None
        shop_url = (self._config.goodies_shop_url or "").strip() or DEFAULT_GOODIES_SHOP_URL
        variant = _email_variant_for_order(self._store, ticket_rows)
        subject, plain, html = build_ticket_email(
            TicketEmailContext(
                buyer_name=ord_row.buyer_name,
                event_title=ev.title,
                when_label=when_label,
                venue_line=venue,
                billet_url=billet_url,
                tickets=tuple(mail_lines),
                contact_url=contact_url,
                variant=variant,
                goodies_shop_url=shop_url,
            )
        )

        try:
            self._send_smtp(ord_row.buyer_email, subject, plain, html, pdf_attachments)
        except Exception as err:
            log.error("notify: send failed order=%s err=%s", order_id, err)

    def _send_smtp(
        self,
        to: str,
        subject: str,
        plain: str,
        html: str | None = None,
        file_attachments: list[tuple[str, bytes]] | None = None,
    ) -> None:
        """Send smtp on ``NotifyService``."""
        msg = EmailMessage()
        msg["From"] = self._config.smtp_from
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(plain)
        if html:
            msg.add_alternative(html, subtype="html")
        if file_attachments:
            for filename, data in file_attachments:
                msg.add_attachment(data, maintype="application", subtype="pdf", filename=filename)
        addr = f"{self._config.smtp_host}:{self._config.smtp_port}"
        with smtplib.SMTP(self._config.smtp_host, self._config.smtp_port, timeout=30) as smtp:
            if self._config.smtp_user:
                smtp.starttls()
                smtp.login(self._config.smtp_user, self._config.smtp_password)
            smtp.send_message(msg)
        log.info("notify: sent confirmation to %s via %s", to, addr)
