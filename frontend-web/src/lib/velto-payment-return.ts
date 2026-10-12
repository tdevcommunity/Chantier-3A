import { ApiError, payments as paymentsApi } from '@/lib/api';

/** Id commande dans l’URL de retour Velto / FedaPay sandbox. */
export function orderIdFromPaymentReturn(searchParams: URLSearchParams): string {
    return (
        searchParams.get('order')?.trim() ||
        searchParams.get('external_reference')?.trim() ||
        ''
    );
}

export function veltoTransactionIdFromReturn(searchParams: URLSearchParams): string {
    return (searchParams.get('transaction_id') || searchParams.get('id') || '').trim();
}

export function isVeltoReturn(searchParams: URLSearchParams): boolean {
    const orderId = orderIdFromPaymentReturn(searchParams);
    if (!orderId) return false;
    if (searchParams.get('velto_return') === '1') return true;
    return veltoTransactionIdFromReturn(searchParams).startsWith('tnx_');
}

const VELTO_PAID_STATUSES = new Set(['APPROVED', 'SUCCESS', 'COMPLETED', 'PAID']);
const VELTO_FAILED_STATUSES = new Set([
    'DECLINED',
    'FAILED',
    'CANCELLED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
]);

function veltoStatusFromUrl(searchParams: URLSearchParams): string {
    return (searchParams.get('status') || '').toUpperCase();
}

export type VeltoReturnOutcome = 'paid' | 'pending' | 'failed' | 'unpaid';

export type VeltoReturnResult = {
    outcome: VeltoReturnOutcome;
    orderId: string;
    buyerEmail: string;
};

async function releasePendingOrder(orderId: string, email: string): Promise<void> {
    try {
        await paymentsApi.abandon(orderId, email);
    } catch {
        /* best-effort */
    }
}

const VERIFY_INTERVAL_MS = 3000;
const VERIFY_MAX_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirmPaidOrder(
    orderId: string,
    veltoTxn: string,
    buyerEmail: string,
): Promise<{ outcome: VeltoReturnOutcome; buyerEmail: string }> {
    for (let i = 0; i < VERIFY_MAX_ATTEMPTS; i++) {
        try {
            const res = await paymentsApi.verify(orderId, veltoTxn || undefined);
            const email =
                res.order.registration?.email?.trim() || res.order.buyer_email?.trim() || buyerEmail;
            return { outcome: 'paid', buyerEmail: email };
        } catch (err) {
            if (!(err instanceof ApiError) || err.status !== 402) {
                return { outcome: 'pending', buyerEmail };
            }
        }
        if (i < VERIFY_MAX_ATTEMPTS - 1) await sleep(VERIFY_INTERVAL_MS);
    }
    return { outcome: 'pending', buyerEmail };
}

/** Après redirection Velto : confirme le paiement côté serveur et nettoie l’URL. */
export async function settleVeltoReturnFromUrl(
    searchParams: URLSearchParams,
    navigate: (path: string, opts?: { replace?: boolean }) => void,
    pathname: string,
    buyerEmailHint = '',
): Promise<VeltoReturnResult | null> {
    if (!isVeltoReturn(searchParams)) return null;
    const orderId = orderIdFromPaymentReturn(searchParams);
    const veltoStatus = veltoStatusFromUrl(searchParams);
    const veltoTxn = veltoTransactionIdFromReturn(searchParams);

    let outcome: VeltoReturnOutcome = 'unpaid';
    let buyerEmail = buyerEmailHint.trim();

    try {
        if (VELTO_FAILED_STATUSES.has(veltoStatus)) {
            outcome = 'failed';
            await releasePendingOrder(orderId, buyerEmail);
        } else {
            const confirmed = await confirmPaidOrder(orderId, veltoTxn, buyerEmail);
            outcome = confirmed.outcome;
            buyerEmail = confirmed.buyerEmail;
            if (outcome === 'pending' && !veltoTxn && !VELTO_PAID_STATUSES.has(veltoStatus)) {
                outcome = 'pending';
            }
        }
    } catch {
        outcome = 'pending';
    }

    const clean = new URLSearchParams(searchParams);
    clean.delete('velto_return');
    clean.delete('order');
    clean.delete('status');
    clean.delete('id');
    clean.delete('transaction_id');
    clean.delete('token');
    clean.delete('external_reference');
    const qs = clean.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname, { replace: true });
    return { outcome, orderId, buyerEmail };
}
