import { ApiError } from '@/lib/api';

const DEV_HINT_PATTERN = /backend-python|VITE_DEV_API_PROXY|8088|Démarrez|localhost|127\.0\.0\.1/i;

const TECHNICAL_MESSAGE_PATTERN =
    /internal|http_\d|request failed|network error|check your connection|unauthorized|forbidden|not found|event not found|provider not|postgresql|database|vault|fedapay|velto|kiiako|whitelist|smtp|api\/|render|vercel|neon|misconfigured|reference is required|payment_not|json|unexpected|fetch failed|cors|nginx|traceback|exception|sql/i;

export interface CheckoutFailureCopy {
    title: string;
    body: string;
}

const GENERIC_UNAVAILABLE: CheckoutFailureCopy = {
    title: 'Billetterie indisponible',
    body: 'Nous ne pouvons pas traiter votre réservation pour le moment. Veuillez réessayer dans quelques instants.',
};

const GENERIC_RESERVATION: CheckoutFailureCopy = {
    title: 'Échec de la réservation',
    body: 'Une erreur est survenue. Veuillez réessayer.',
};

const PAYMENT_NOT_CONFIRMED: CheckoutFailureCopy = {
    title: 'Paiement non confirmé',
    body: 'Votre paiement Mobile Money n’a pas encore été confirmé. Aucun billet n’a été créé. Vous pouvez réessayer.',
};

const SOLD_OUT: CheckoutFailureCopy = {
    title: 'Pass indisponible',
    body: 'Ce pass n’est plus disponible pour le moment. Revenez plus tard ou choisissez un autre pass.',
};

function looksLikeVisitorFrench(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 280) return false;
    if (TECHNICAL_MESSAGE_PATTERN.test(t)) return false;
    if (DEV_HINT_PATTERN.test(t)) return false;
    if (/^[A-Za-z0-9\s._\-:'",!?()/]+$/.test(t) && !/[àâäéèêëïîôùûüç]/i.test(t)) {
        return false;
    }
    return true;
}

/** Détails techniques : console uniquement, jamais dans les modales visiteur. */
export function logCheckoutDiagnostic(context: string, err: unknown): void {
    if (err instanceof ApiError) {
        console.error(`[billetterie:${context}]`, {
            code: err.code,
            status: err.status,
            message: err.message,
            cause: err.cause,
        });
        return;
    }
    console.error(`[billetterie:${context}]`, err);
}

function copyFromApiError(err: ApiError): CheckoutFailureCopy {
    switch (err.code) {
        case 'duplicate_registration':
            return {
                title: 'Inscription impossible',
                body: 'Impossible de finaliser cette inscription avec ces informations.',
            };
        case 'payment_not_confirmed':
            return PAYMENT_NOT_CONFIRMED;
        case 'database_unavailable':
        case 'network_error':
            return GENERIC_UNAVAILABLE;
        case 'ticketing_unavailable':
            return {
                title: 'Billet en cours d’émission',
                body: 'Votre paiement est enregistré. Votre billet arrive par e-mail sous peu ; vous pouvez aussi réessayer le téléchargement dans quelques minutes.',
            };
        case 'not_found':
            return {
                title: 'Événement indisponible',
                body: 'Les inscriptions ne sont pas ouvertes pour le moment. Revenez un peu plus tard.',
            };
        case 'sold_out':
            return SOLD_OUT;
        default:
            break;
    }

    if (err.status === 402) return PAYMENT_NOT_CONFIRMED;
    if (err.status === 404) {
        return {
            title: 'Événement indisponible',
            body: 'Les inscriptions ne sont pas ouvertes pour le moment. Revenez un peu plus tard.',
        };
    }
    if (err.status === 409 && err.code === 'duplicate_registration') {
        return {
            title: 'Inscription impossible',
            body: 'Impossible de finaliser cette inscription avec ces informations.',
        };
    }

    const infra =
        err.status === 0 ||
        err.status >= 500 ||
        err.code.startsWith('http_5') ||
        err.code === 'internal_error' ||
        DEV_HINT_PATTERN.test(err.message);

    if (infra) return GENERIC_UNAVAILABLE;

    if (err.status === 400 && err.code === 'invalid_request') {
        const msg = err.message.trim();
        if (
            msg.startsWith('Formulaire incomplet') ||
            msg.includes('Mobile Money invalide') ||
            msg.startsWith('Adresse e-mail')
        ) {
            return { title: 'Échec de la réservation', body: msg };
        }
    }
    if (err.status === 422) {
        return GENERIC_RESERVATION;
    }

    return GENERIC_RESERVATION;
}

/** Messages visiteur pour les popups d'échec (sans jargon technique). */
export function checkoutFailureCopy(err: unknown): CheckoutFailureCopy {
    if (err instanceof Error && err.message === 'velto_declined') {
        return PAYMENT_NOT_CONFIRMED;
    }

    if (err instanceof ApiError) {
        return copyFromApiError(err);
    }

    if (err instanceof Error && err.message.trim()) {
        if (DEV_HINT_PATTERN.test(err.message) || TECHNICAL_MESSAGE_PATTERN.test(err.message)) {
            return GENERIC_UNAVAILABLE;
        }
        const msg = err.message.trim();
        if (looksLikeVisitorFrench(msg)) {
            return { title: 'Échec de la réservation', body: msg };
        }
    }

    return GENERIC_RESERVATION;
}
