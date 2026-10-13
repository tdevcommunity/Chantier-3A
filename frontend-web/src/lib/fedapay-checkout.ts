import { ApiError, orders as ordersApi, payments as paymentsApi } from '@/lib/api';
import { getOptionalEnv } from '@/lib/env';

/**
 * Paiement FedaPay via Checkout.js.
 *
 * La transaction est créée par le backend (montant = total de la commande) ; le navigateur ne
 * reçoit que son identifiant. Le résultat du widget ne sert qu'à l'interface : le billet n'est
 * émis qu'après `POST /api/payments/verify`, qui interroge FedaPay côté serveur.
 *
 * Le widget est une iframe ajoutée à `body` : si une modale Radix est ouverte, `body` a
 * `pointer-events: none` et le widget est visible mais impossible à cliquer. Fermer les modales
 * avant d'appeler `payWithFedapay`.
 */

const CHECKOUT_SCRIPT_URL = 'https://cdn.fedapay.com/checkout.js?v=1.1.7';
const VERIFY_INTERVAL_MS = 3000;
const VERIFY_MAX_ATTEMPTS = 20;

export type PaymentOutcome = 'paid' | 'pending' | 'dismissed';

export interface PaymentCustomer {
    email: string;
    firstname?: string;
    lastname?: string;
}

interface FedaPayWidget {
    open?: () => void;
}

interface FedaPayGlobal {
    CHECKOUT_COMPLETED: unknown;
    DIALOG_DISMISSED: unknown;
    init: (options: Record<string, unknown>) => FedaPayWidget;
}

declare global {
    interface Window {
        FedaPay?: FedaPayGlobal;
    }
}

let scriptPromise: Promise<FedaPayGlobal> | null = null;

function loadCheckoutScript(): Promise<FedaPayGlobal> {
    if (window.FedaPay) return Promise.resolve(window.FedaPay);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<FedaPayGlobal>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CHECKOUT_SCRIPT_URL;
        script.async = true;
        script.onload = () => {
            if (window.FedaPay) resolve(window.FedaPay);
            else reject(new Error('Le module de paiement est indisponible.'));
        };
        script.onerror = () => reject(new Error('Impossible de charger le module de paiement.'));
        document.head.appendChild(script);
    }).catch((err) => {
        scriptPromise = null;
        throw err;
    });
    return scriptPromise;
}

function publicKey(): string {
    const key = getOptionalEnv('VITE_FEDAPAY_PUBLIC_KEY');
    if (!key) throw new Error('Le paiement en ligne n\'est pas configuré.');
    return key;
}

function widgetEnvironment(): 'sandbox' | 'live' {
    return getOptionalEnv('VITE_FEDAPAY_ENV') === 'live' ? 'live' : 'sandbox';
}

/** Ouvre le widget sur une transaction existante ; résout quand l'acheteur le ferme. */
async function openWidget(transactionId: string, customer: PaymentCustomer): Promise<'completed' | 'dismissed'> {
    const fedapay = await loadCheckoutScript();
    return new Promise((resolve) => {
        const widget = fedapay.init({
            public_key: publicKey(),
            environment: widgetEnvironment(),
            locale: 'fr',
            transaction: { id: Number(transactionId) },
            customer,
            onComplete: (reason: unknown) => {
                resolve(reason === fedapay.CHECKOUT_COMPLETED ? 'completed' : 'dismissed');
            },
        });
        widget.open?.();
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Interroge le backend jusqu'à confirmation. 402 = pas encore payé (Mobile Money asynchrone).
 * Toute autre erreur est propagée.
 */
export async function confirmPayment(
    orderId: string,
    buyerEmail: string,
    { attempts = VERIFY_MAX_ATTEMPTS, intervalMs = VERIFY_INTERVAL_MS } = {},
): Promise<'paid' | 'pending'> {
    const email = buyerEmail.trim();
    for (let i = 0; i < attempts; i++) {
        try {
            await paymentsApi.verify(orderId, email);
            return 'paid';
        } catch (err) {
            if (!(err instanceof ApiError) || err.status !== 402) throw err;
        }
        if (i < attempts - 1) await sleep(intervalMs);
    }
    return 'pending';
}

async function recoverPaidOrder(orderId: string, email: string): Promise<boolean> {
    try {
        const guest = await ordersApi.getGuest(orderId, email.trim());
        return (guest.tickets?.length ?? 0) > 0;
    } catch {
        return false;
    }
}

/** Ouvre le widget puis confirme côté serveur. */
export async function payWithFedapay(params: {
    orderId: string;
    transactionId: string;
    customer: PaymentCustomer;
}): Promise<PaymentOutcome> {
    const { orderId, transactionId, customer } = params;
    const email = customer.email.trim();
    try {
        const result = await openWidget(transactionId, customer);
        if (result === 'dismissed') {
            // Une fermeture peut suivre un paiement déjà accepté : une seule vérification.
            const once = await confirmPayment(orderId, email, { attempts: 1 });
            if (once === 'paid') return 'paid';
            if (await recoverPaidOrder(orderId, email)) return 'paid';
            return 'dismissed';
        }
        const confirmed = await confirmPayment(orderId, email);
        if (confirmed === 'paid') return 'paid';
        if (await recoverPaidOrder(orderId, email)) return 'paid';
        return confirmed;
    } catch (err) {
        if (await recoverPaidOrder(orderId, email)) return 'paid';
        throw err;
    }
}
