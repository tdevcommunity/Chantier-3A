import { ApiError } from '@/lib/api';
import { clearBilletterieStorefrontCache } from '@/lib/billetterie-storefront';

export type CheckoutTierId = 'student' | 'vip';

/** Stock épuisé ou pass retiré de la vente — pas une panne technique. */
export class SoldOutError extends Error {
    readonly tier?: CheckoutTierId;

    constructor(tier?: CheckoutTierId) {
        super('sold_out');
        this.name = 'SoldOutError';
        this.tier = tier;
    }
}

export const CHECKOUT_SOLD_OUT_COPY = {
    title: 'Places finies',
    body: 'La billetterie pour ce pass est complète. Merci pour votre intérêt — consultez nos autres offres ou revenez si des places se libèrent.',
} as const;

export function isSoldOutError(err: unknown): boolean {
    if (err instanceof SoldOutError) return true;
    if (err instanceof ApiError) {
        if (err.code === 'sold_out') return true;
        if (err.status === 409) {
            const msg = err.message.toLowerCase();
            if (msg.includes('plus disponible') || msg.includes('épuis')) return true;
        }
    }
    return false;
}

export function clearStorefrontCacheIfSoldOut(err: unknown): void {
    if (isSoldOutError(err)) clearBilletterieStorefrontCache();
}