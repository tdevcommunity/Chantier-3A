"""Wire payment providers, orders, notifications, and key vault at startup."""

from __future__ import annotations

import os
from dataclasses import dataclass

from config import Config
from notify.notify import NotifyService
from orders.service import OrdersService
from payments.fedapay import FedapayProvider
from payments.velto import VeltoProvider
from payments.free import FreeProvider
from payments.manual import ManualProvider
from payments.registry import Registry
from payments.remote import RemotePaymentProvider
from payments.stub import StubProvider
from store import keyvault_crypto as kv
from store import keyvault_db
from store.store import Store


@dataclass
class AppServices:
    """Shared singletons attached to the FastAPI app state."""
    payments: Registry
    orders: OrdersService
    notify: NotifyService
    webhook_seen: _MemorySeenStore


class _MemorySeenStore:
    """In-process webhook idempotency cache (single-node deployments)."""

    def __init__(self) -> None:
        """Initialize an empty seen-event set."""
        self._seen: set[str] = set()

    def mark_seen(self, provider: str, event_id: str) -> bool:
        """Record a provider event id; return False if it was already seen."""
        key = f"{provider}:{event_id}"
        if key in self._seen:
            return False
        self._seen.add(key)
        return True


def unlock_store_vault(store: Store, config: Config) -> None:
    """Unlock the org key vault using demo, passphrase, or leave locked."""
    if config.demo:
        keyvault_db.unlock_key_vault(store, kv.Source.demo(), demo=True)
        return
    if config.key_passphrase:
        keyvault_db.unlock_key_vault(store, kv.Source.passphrase(config.key_passphrase))
        return


def build_payment_registry(store: Store, config: Config) -> Registry:
    """Register manual, demo stub, and remote payment providers from config."""
    reg = Registry.from_env(os.environ.get("CHANTIER3A_PAYMENT_PROVIDERS", ""))
    manual = ManualProvider(store=store)
    reg.register(manual)
    reg.register(FreeProvider())
    if config.demo:
        reg.register(StubProvider(opt_in=True))
    if config.payment_service_url:
        reg.register(
            RemotePaymentProvider(
                base_url=config.payment_service_url,
                api_key=config.payment_service_api_key,
                webhook_secret=config.payment_webhook_secret,
                provider_name=config.payment_provider_name,
                timeout=float(config.payment_service_timeout),
            )
        )
    if config.fedapay_secret_key:
        reg.register(
            FedapayProvider(
                secret_key=config.fedapay_secret_key,
                webhook_secret=config.fedapay_webhook_secret,
                environment=config.fedapay_env,
                timeout=float(config.payment_service_timeout),
                default_callback_url=config.base_url,
            )
        )
    if config.velto_secret_key:
        reg.register(
            VeltoProvider(
                secret_key=config.velto_secret_key,
                webhook_secret=config.velto_webhook_secret,
                timeout=float(config.payment_service_timeout),
                default_callback_url=(config.storefront_url or config.base_url or "").strip(),
            )
        )
    return reg


def build_services(store: Store, config: Config) -> AppServices:
    """Construct payment registry, orders, notify, and webhook deduplication services."""
    unlock_store_vault(store, config)
    payments = build_payment_registry(store, config)
    notify = NotifyService(store, config)
    orders = OrdersService(store, payments, notify=notify, storefront_url=config.storefront_url)
    return AppServices(payments=payments, orders=orders, notify=notify, webhook_seen=_MemorySeenStore())


def bootstrap_staff_account(
    store: Store,
    *,
    email: str,
    password: str,
    name: str,
    org_slug: str = "tdev",
    role: str = "owner",
) -> dict[str, str]:
    """CLI bootstrap-staff: owner/admin on org tdev (requires CHANTIER3A_BOOTSTRAP_STAFF=1)."""
    from datetime import datetime, timezone

    from auth import service as auth_svc
    from auth.password import hash_password
    from store import NotFoundError
    from store import orgs as orgs_repo
    from store import users as user_store

    if os.getenv("CHANTIER3A_BOOTSTRAP_STAFF", "").strip().lower() not in ("1", "true", "yes", "on"):
        raise SystemExit(
            "billetterie-api: definissez CHANTIER3A_BOOTSTRAP_STAFF=1 pour creer ou mettre a jour un compte staff."
        )
    if len(password) < auth_svc.MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"billetterie-api: mot de passe trop court (minimum {auth_svc.MIN_PASSWORD_LENGTH} caracteres)."
        )
    if role not in ("owner", "admin", "scanner"):
        raise SystemExit("billetterie-api: role invalide (owner, admin, scanner).")

    org = orgs_repo.get_org_by_slug(store, org_slug)
    norm = email.strip().lower()
    now = datetime.now(timezone.utc)

    try:
        existing = user_store.get_user_by_email(store, norm)
        user_store.update_password_hash(store, existing.id, hash_password(password))
        user_id = existing.id
        user_action = "mot de passe mis a jour"
    except NotFoundError:
        user = auth_svc.signup(store, norm, password, name.strip() or norm.split("@")[0])
        user_id = user.id
        user_action = "compte cree"

    try:
        orgs_repo.get_org_member_role(store, org.id, user_id)
        store.execute(
            "UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?",
            (role, org.id, user_id),
        )
        member_action = f"role {role} sur org {org_slug}"
    except NotFoundError:
        orgs_repo.add_org_member(store, org.id, user_id, role, now)
        member_action = f"ajoute comme {role} sur org {org_slug}"

    return {
        "email": norm,
        "user_action": user_action,
        "member_action": member_action,
        "org_id": org.id,
    }
