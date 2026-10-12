"""Velto (Kiiako) Mobile Money: server-created payments with checkout redirect."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

import httpx

from payments import types as pt

PROVIDER_NAME_VELTO = "velto"

_BASE_URL = "https://velto-gate.kiiako.io/v1"

_EVENT_SUCCESS = "payment.success"
_PAID_STATUSES = {"APPROVED", "approved", "SUCCESS", "success", "COMPLETED", "completed", "PAID", "paid"}
_PENDING_STATUSES = {"PENDING", "pending", "PROCESSING", "processing"}
_FAILED_STATUSES = {"DECLINED", "declined", "FAILED", "failed", "CANCELLED", "cancelled"}


class VeltoProvider:
    """Creates payments via POST /v1/payments; settlement confirmed via API (fail closed)."""

    def __init__(
        self,
        *,
        secret_key: str,
        webhook_secret: str = "",
        timeout: float = 30.0,
        default_callback_url: str = "",
        client: httpx.Client | None = None,
    ) -> None:
        self._secret_key = secret_key
        self._webhook_secret = webhook_secret or secret_key
        self._timeout = timeout
        self._default_callback_url = default_callback_url
        self._client = client
        self._txn_by_reference: dict[str, str] = {}

    def name(self) -> str:
        return PROVIDER_NAME_VELTO

    def capabilities(self) -> pt.Capabilities:
        return pt.Capabilities(currencies=["XOF"], flow=pt.Flow.REDIRECT, webhooks=True)

    def begin(self, order: pt.Order) -> pt.Charge:
        if not self.capabilities().supports_currency(order.currency):
            raise ValueError(f"velto: unsupported currency {order.currency}")
        callback = (order.callback_url or self._default_callback_url).strip()
        if not callback:
            raise ValueError("velto: callback_url is required for checkout return")
        payload: dict = {
            "amount": order.amount_minor,
            "currency": order.currency.upper(),
            "description": f"Commande {order.reference}",
            "callback_url": callback,
            "external_reference": order.reference,
            "customer": {
                "name": order.buyer_name.strip() or order.buyer_email,
                "email": order.buyer_email,
            },
        }
        meta = {k: str(v) for k, v in order.metadata.items() if k != "phone" and v}
        if meta:
            payload["metadata"] = meta
        origin, referer = _browser_headers_from_callback(callback)
        resp = self._request(
            "POST",
            "/payments",
            json=payload,
            browser_origin=origin,
            referer=referer,
        )
        if resp.status_code >= 400:
            detail = _api_error_message(resp)
            raise ValueError(f"velto: {detail}")
        resp.raise_for_status()
        txn = _unwrap(resp.json())
        txn_id = str(txn.get("id") or "").strip()
        checkout_url = str(txn.get("checkout_url") or "").strip()
        if not txn_id or not checkout_url:
            raise ValueError("velto: payment id or checkout_url missing in response")
        self._txn_by_reference[order.reference] = txn_id
        return pt.Charge(
            provider=self.name(),
            reference=order.reference,
            redirect_url=checkout_url,
            client_token=txn_id,
        )

    def verify(self, reference: str) -> pt.Result:
        return self.verify_for_order(reference, None)

    def verify_for_order(self, order_reference: str, provider_ref: str | None) -> pt.Result:
        """Confirm payment for one checkout session (Velto transaction id), fail closed."""
        txn_id = (provider_ref or "").strip()
        if txn_id == order_reference:
            txn_id = ""
        if txn_id:
            txn = self._fetch_txn_by_id(txn_id)
            if txn is None:
                txn = self._find_latest_by_external_reference(order_reference)
                if txn is None:
                    return _pending_result(self.name(), order_reference)
            else:
                ext = str(txn.get("external_reference") or "").strip()
                if ext and ext != order_reference:
                    return _pending_result(self.name(), order_reference)
            return self._to_result(txn, order_reference)
        txn_id = self._txn_by_reference.get(order_reference)
        if txn_id:
            resp = self._request("GET", f"/payments/{quote(txn_id, safe='')}")
            if resp.status_code == 404:
                return _pending_result(self.name(), order_reference)
            resp.raise_for_status()
            return self._to_result(_unwrap(resp.json()), order_reference)
        txn = self._find_latest_by_external_reference(order_reference)
        if txn is None:
            return _pending_result(self.name(), order_reference)
        ext = str(txn.get("external_reference") or "").strip()
        if ext and ext != order_reference:
            return _pending_result(self.name(), order_reference)
        return self._to_result(txn, order_reference)

    def webhook(self, body: bytes, headers: dict[str, str]) -> pt.Result:
        lowered = {k.lower(): v for k, v in headers.items()}
        if not self._verify_signature(body, lowered.get("x-velto-signature", "")):
            raise ValueError("invalid webhook signature")
        event = json.loads(body.decode())
        name = str(event.get("event") or "")
        if name != _EVENT_SUCCESS:
            if name.endswith(".declined") or name == "payment.failed":
                ref = str(event.get("external_reference") or "")
                return pt.Result(
                    provider=self.name(),
                    reference=ref,
                    event_id=f"{name}:{event.get('transaction_id', '')}",
                    status=pt.Status.FAILED,
                    amount_minor=int(event.get("amount") or 0),
                    currency=str(event.get("currency") or "XOF").upper(),
                )
            raise pt.ErrUnhandledEvent
        txn_id = str(event.get("transaction_id") or "").strip()
        ref = str(event.get("external_reference") or "").strip()
        if txn_id:
            resp = self._request("GET", f"/payments/{quote(txn_id, safe='')}")
            resp.raise_for_status()
            result = self._to_result(_unwrap(resp.json()), ref or None)
        elif ref:
            txn = self._find_latest_by_external_reference(ref)
            if txn is None:
                raise ValueError("webhook without resolvable transaction")
            result = self._to_result(txn, ref)
        else:
            raise ValueError("webhook without transaction identifier")
        if result.status != pt.Status.PAID:
            raise ValueError("webhook payment.success but transaction is not approved")
        result.event_id = f"{name}:{result.event_id or txn_id}"
        return result

    def _fetch_txn_by_id(self, txn_id: str) -> dict | None:
        tid = txn_id.strip()
        if not tid:
            return None
        resp = self._request("GET", f"/payments/{quote(tid, safe='')}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return _unwrap(resp.json())

    def _find_latest_by_external_reference(self, reference: str) -> dict | None:
        matches: list[dict] = []
        page = 1
        while page <= 10:
            resp = self._request("GET", f"/payments?page={page}&limit=100")
            resp.raise_for_status()
            body = resp.json()
            items = body.get("data")
            if not isinstance(items, list):
                items = []
            for item in items:
                if isinstance(item, dict) and str(item.get("external_reference") or "") == reference:
                    matches.append(item)
            meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
            total_pages = int(meta.get("totalPages") or meta.get("total_pages") or 1)
            if page >= total_pages:
                break
            page += 1
        if not matches:
            return None
        latest = max(matches, key=_txn_sort_key)
        tid = str(latest.get("id") or "").strip()
        if not tid:
            return None
        return self._fetch_txn_by_id(tid)

    def _request(
        self,
        method: str,
        path: str,
        *,
        browser_origin: str = "",
        referer: str = "",
        **kwargs: object,
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._secret_key}", "Content-Type": "application/json"}
        if not browser_origin and self._default_callback_url.strip():
            browser_origin, referer = _browser_headers_from_callback(self._default_callback_url)
        if browser_origin:
            headers["Origin"] = browser_origin
        if referer:
            headers["Referer"] = referer
        if self._client is not None:
            return self._client.request(method, path, headers=headers, **kwargs)
        with httpx.Client(base_url=_BASE_URL, timeout=self._timeout) as client:
            return client.request(method, path, headers=headers, **kwargs)

    def _verify_signature(self, body: bytes, signature: str) -> bool:
        if not self._webhook_secret or not signature:
            return False
        expected = hmac.new(self._webhook_secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature.strip())

    def _to_result(self, txn: dict, reference: str | None = None) -> pt.Result:
        status_raw = str(txn.get("status") or "")
        if status_raw in _PAID_STATUSES:
            status = pt.Status.PAID
        elif status_raw in _PENDING_STATUSES:
            status = pt.Status.PENDING
        elif status_raw in _FAILED_STATUSES:
            status = pt.Status.FAILED
        else:
            status = pt.Status.PENDING
        ref = reference or str(txn.get("external_reference") or "")
        currency = str(txn.get("currency") or "XOF").upper()
        amount = int(txn.get("amount") or txn.get("origin_amount") or 0)
        return pt.Result(
            provider=self.name(),
            reference=ref,
            event_id=str(txn.get("id") or ""),
            status=status,
            amount_minor=amount,
            currency=currency,
            paid_at=_parse_time(txn.get("created_at")),
            raw=txn,
        )


def _normalize_phone(raw: str) -> str:
    """Mobile Money : chiffres internationaux (Togo 228…, Bénin 229…)."""
    digits = "".join(ch for ch in raw.strip() if ch.isdigit())
    if not digits:
        return ""
    while digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 9 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 8:
        digits = f"228{digits}"
    return digits


def _friendly_phone_error() -> str:
    return (
        "Numéro Mobile Money invalide. Utilisez le format international sans 0 initial "
        "(ex. 22890123456 pour le Togo, 22997123456 pour le Bénin)."
    )


def _browser_headers_from_callback(callback_url: str) -> tuple[str, str]:
    parsed = urlparse(callback_url.strip())
    if not parsed.scheme or not parsed.netloc:
        return "", ""
    origin = f"{parsed.scheme}://{parsed.netloc}"
    referer = callback_url if callback_url.startswith(origin) else f"{origin}/"
    return origin, referer


def _api_error_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict):
            if body.get("error"):
                msg = str(body["error"])
                details = body.get("details")
                if isinstance(details, dict) and details:
                    blob = str(details)
                    if "phone_number" in blob:
                        return _friendly_phone_error()
                return msg
    except Exception:
        pass
    return f"HTTP {resp.status_code}"


def _txn_sort_key(txn: dict) -> tuple:
    created = _parse_time(txn.get("created_at"))
    ts = created.timestamp() if created else 0.0
    tid = str(txn.get("id") or "")
    return (ts, tid)


def _unwrap(data: dict) -> dict:
    if isinstance(data.get("data"), dict):
        return data["data"]
    return data


def _pending_result(provider: str, reference: str) -> pt.Result:
    return pt.Result(provider=provider, reference=reference, status=pt.Status.PENDING, currency="XOF")


def _parse_time(raw: object) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    text = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
