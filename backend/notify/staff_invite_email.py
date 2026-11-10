"""Modèle d'e-mail d'accès staff (invitation admin / scanner)."""

from __future__ import annotations

import html
from dataclasses import dataclass


_ROLE_LABELS = {
    "owner": "Super Admin",
    "admin": "Administrateur",
    "scanner": "Contrôle entrée",
}


@dataclass(frozen=True)
class StaffInviteEmailContext:
    """Données pour l'e-mail d'accès à l'espace organisateur."""

    org_name: str
    role: str
    login_url: str
    invited_email: str
    account_created: bool
    default_password: str | None = None
    contact_url: str | None = None
    mobile_scanner: bool = False


def role_label(role: str) -> str:
    """Libellé français du rôle staff."""
    return _ROLE_LABELS.get(role.strip(), role.strip() or "Membre")


def _esc(text: str) -> str:
    return html.escape(text.strip(), quote=True)


def build_staff_invite_email(ctx: StaffInviteEmailContext) -> tuple[str, str, str]:
    """Retourne (subject, plain_text, html_body)."""
    org = ctx.org_name.strip() or "Tdev Festival"
    role_fr = role_label(ctx.role)
    login = ctx.login_url.strip()
    email_addr = ctx.invited_email.strip()

    if ctx.mobile_scanner:
        subject = f"Application contrôle entrée (mobile) - {org}"
        headline = "Accès scanner mobile"
        access_plain = f"""\
Application mobile (contrôle entrée)
  Ouvrez ce lien sur votre téléphone (iPhone ou Android) :
  {login}

  Après connexion, vous accéderez directement au scan des QR codes à l'entrée.
  Astuce : ajoutez la page à l'écran d'accueil pour un accès rapide le jour J."""
        access_html = f"""
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                Ouvrez le lien ci-dessous <strong style="color:#fff;">sur votre téléphone</strong>
                (connexion Wi-Fi ou 4G sur le site du festival).
              </p>
              <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#737373;">
                Après connexion, l'application de scan s'ouvre pour valider les billets à l'entrée.
                Vous pouvez épingler la page sur l'écran d'accueil pour y revenir en un geste.
              </p>"""
        cta_label = "Ouvrir le scanner sur mobile"
        after_login_plain = "Utilisez l'application pour scanner les QR codes des participants à l'entrée."
        role_intro_plain = (
            f"Vous avez été ajouté(e) comme agent de contrôle entrée pour « {org} » "
            f"(Tdev Festival)."
        )
    else:
        subject = f"Accès organisateur Tdev Festival - {org}"
        headline = "Accès organisateur"
        access_plain = f"Page de connexion (ordinateur ou tablette) :\n{login}"
        access_html = ""
        cta_label = "Se connecter"
        after_login_plain = (
            "Après connexion, vous pourrez accéder au tableau de bord "
            "(billetterie, événements, équipe)."
        )
        role_intro_plain = (
            f"Vous avez été ajouté(e) à l'équipe organisatrice de « {org} » "
            f"sur la billetterie Tdev Festival.\n\nRôle : {role_fr}"
        )

    if ctx.account_created and ctx.default_password:
        pwd = ctx.default_password.strip()
        cred_plain = f"""\
Identifiants de connexion
  E-mail : {email_addr}
  Mot de passe initial : {pwd}

Changez ce mot de passe après votre première connexion si possible."""
        cred_html = f"""
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                Utilisez les identifiants suivants pour vous connecter :
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#1a1a1a;border:1px solid #333;border-radius:12px;">
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#a3a3a3;width:120px;vertical-align:top;">E-mail</td>
                  <td style="padding:14px 16px 14px 0;font-size:14px;color:#f5f5f5;font-family:ui-monospace,monospace;">{_esc(email_addr)}</td>
                </tr>
                <tr>
                  <td style="padding:0 16px 14px;font-size:13px;color:#a3a3a3;vertical-align:top;">Mot de passe</td>
                  <td style="padding:0 16px 14px 0;font-size:14px;color:#6ee7b7;font-family:ui-monospace,monospace;font-weight:600;">{_esc(pwd)}</td>
                </tr>
              </table>
              <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#737373;">
                Conservez ce message en lieu sûr. Nous vous recommandons de modifier ce mot de passe après la première connexion.
              </p>"""
    else:
        cred_plain = f"""\
Connexion
  E-mail : {email_addr}
  Mot de passe : utilisez le mot de passe de votre compte existant."""
        cred_html = f"""
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                Connectez-vous avec l'e-mail <strong style="color:#fff;">{_esc(email_addr)}</strong>
                et le mot de passe de votre compte Tdev Festival existant.
              </p>"""

    contact_plain = ""
    contact_html = ""
    if ctx.contact_url:
        contact_plain = f"\nUne question ? {ctx.contact_url.strip()}\n"
        contact_html = f"""
    <p style="margin:24px 0 0;font-size:13px;color:#737373;line-height:1.5;text-align:center;">
      Une question ?
      <a href="{_esc(ctx.contact_url.strip())}" style="color:#34d399;text-decoration:none;">Contactez l'équipe T-Dev</a>
    </p>"""

    plain = f"""\
Bonjour,

{role_intro_plain}

{cred_plain}

{access_plain}

{after_login_plain}

À bientôt,
L'équipe T-Dev Festival
{contact_plain}"""

    html_body = f"""\
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#141414;border:1px solid #262626;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 20px;background:linear-gradient(135deg,#064e3b 0%,#0a0a0a 100%);">
              <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6ee7b7;">Tdev Festival 2026</p>
              <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;color:#ffffff;">{_esc(headline)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e5e5e5;">Bonjour,</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#d4d4d4;">
                Vous avez été ajouté(e) à l'équipe de
                <strong style="color:#ffffff;">{_esc(org)}</strong>
                avec le rôle <strong style="color:#ffffff;">{_esc(role_fr)}</strong>.
              </p>
              {cred_html}
              {access_html}
              <p style="margin:0 0 24px;text-align:center;">
                <a href="{_esc(login)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-size:15px;font-weight:600;">{_esc(cta_label)}</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#737373;text-align:center;">
                Lien direct : <a href="{_esc(login)}" style="color:#34d399;text-decoration:none;">{_esc(login)}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid #262626;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#737373;text-align:center;">
                L'équipe T-Dev Festival
              </p>
              {contact_html}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    return subject, plain, html_body
