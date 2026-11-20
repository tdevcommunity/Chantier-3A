import { events } from '@/lib/api';
import type { FestivalEvent, TicketType } from '@/lib/api-types';
import { getFestivalEventSlug } from '@/lib/env';
import { formatMoney } from '@/lib/money';
import { productKindOf, remainingFor, visibleTicketTypes } from '@/lib/ticket-utils';
import { WELCOME_PACK_SHOP_URL } from '@/lib/static-billetterie-catalog';
import { SoldOutError, type CheckoutTierId } from '@/lib/sold-out';

export interface BilletterieProduct {
    ticketType: TicketType;
    title: string;
    subtitle?: string;
    priceLabel: string;
    isFree: boolean;
    description: string;
    inclusions: string[];
    category: string;
    popular: boolean;
    badgeText?: string;
    externalUrl?: string;
}

const DEFAULT_INCLUSIONS: Record<string, string[]> = {
    student: [
        'Conférences tech et innovation',
        'Expositions et stands',
        'Ateliers pratiques',
        'Badge participant',
    ],
    vip: ['Soirée jeux et gaming', 'Cosplay manga', 'DJ set en direct', 'Projections exclusives'],
    standard: ['Accès aux deux jours', 'Conférences et ateliers', 'Espaces partenaires'],
};

function resolveEventSlug(configured: string | undefined, eventsList: FestivalEvent[]): string | null {
    const slug = configured?.trim();
    if (slug) return slug;
    const published = eventsList.find((e) => e.status === 'published') ?? eventsList[0];
    return published?.slug || published?.id || null;
}

function inclusionsFor(tt: TicketType): string[] {
    const tier = tt.pass_tier?.toLowerCase();
    if (tier && DEFAULT_INCLUSIONS[tier]) return DEFAULT_INCLUSIONS[tier];
    const lines = (tt.description || '')
        .split(/[\n;•]/)
        .map((s) => s.trim())
        .filter(Boolean);
    return lines.length > 0 ? lines.slice(0, 6) : ['Accès à l\'événement'];
}

function mapProduct(tt: TicketType, currency: string): BilletterieProduct {
    const kind = productKindOf(tt);
    const isFree = kind === 'ticket' && tt.price_minor === 0;
    const tier = tt.pass_tier?.toLowerCase();

    if (kind === 'goodie') {
        return {
            ticketType: tt,
            title: tt.name,
            subtitle: 'Pack goodies',
            priceLabel: 'Sur choix',
            isFree: false,
            description: tt.description || 'Kit officiel du festival.',
            inclusions: inclusionsFor(tt),
            category: 'Goodies et merch',
            popular: false,
            badgeText: 'Édition limitée',
            externalUrl: WELCOME_PACK_SHOP_URL,
        };
    }

    const product: BilletterieProduct = {
        ticketType: tt,
        title: tt.name,
        priceLabel: isFree ? 'GRATUIT' : formatMoney(tt.price_minor, currency),
        isFree,
        description: tt.description || '',
        inclusions: inclusionsFor(tt),
        category: tier === 'vip' ? 'Soirée et entertainment' : 'Accès général',
        popular: tier === 'student',
    };
    if (tier === 'vip') product.subtitle = 'Soirée exclusive';
    else if (tier === 'student') product.subtitle = 'Accès général';
    if (tier === 'vip') product.badgeText = 'Événement spécial';
    else if (tier === 'student') product.badgeText = 'Pass incontournable';
    return product;
}

let liveStorefrontCache: {
    event: FestivalEvent;
    products: BilletterieProduct[];
} | null = null;

/** Invalide le cache après changement d'environnement ou de déploiement API. */
export function clearBilletterieStorefrontCache(): void {
    liveStorefrontCache = null;
}

export async function loadBilletterieStorefront(): Promise<{
    event: FestivalEvent;
    products: BilletterieProduct[];
}> {
    const list = await events.list();
    const slug = resolveEventSlug(getFestivalEventSlug(), list.events ?? []);
    if (!slug) {
        throw new Error('Aucun événement publié disponible.');
    }
    const detail = await events.get(slug);
    const currency = detail.event.currency || 'XOF';
    const types = visibleTicketTypes(detail.ticket_types ?? []).filter((t) => remainingFor(t) > 0);

    const tickets = types.filter((t) => productKindOf(t) === 'ticket').sort((a, b) => a.sort_order - b.sort_order);
    const goodies = types.filter((t) => productKindOf(t) === 'goodie').sort((a, b) => a.sort_order - b.sort_order);

    const products = [...tickets, ...goodies].map((tt) => mapProduct(tt, currency));
    if (products.length === 0) {
        throw new Error('Aucun billet disponible pour le moment.');
    }
    return { event: detail.event, products };
}

async function loadBilletterieStorefrontCached(): Promise<{
    event: FestivalEvent;
    products: BilletterieProduct[];
}> {
    if (liveStorefrontCache) return liveStorefrontCache;
    liveStorefrontCache = await loadBilletterieStorefront();
    return liveStorefrontCache;
}

function productMatchesCheckoutTier(product: BilletterieProduct, tier: string): boolean {
    if (product.externalUrl) return false;
    const passTier = product.ticketType.pass_tier?.toLowerCase();
    return passTier === tier;
}

/**
 * Charge l'API uniquement au checkout (pass gratuit, pass payant).
 * La landing utilise {@link getStaticBilletterieListing} sans appel réseau.
 */
async function ticketTypeSoldOutForTier(tier: CheckoutTierId): Promise<boolean> {
    const list = await events.list();
    const slug = resolveEventSlug(getFestivalEventSlug(), list.events ?? []);
    if (!slug) return false;
    const detail = await events.get(slug);
    const tickets = visibleTicketTypes(detail.ticket_types ?? []).filter(
        (t) => productKindOf(t) === 'ticket',
    );
    const match = tickets.find((t) => t.pass_tier?.toLowerCase() === tier);
    if (!match) return false;
    return remainingFor(match) <= 0;
}

/**
 * Vérifie le stock live avant d'ouvrir ou d'envoyer le formulaire d'inscription.
 * Invalide le cache vitrine si demandé (re-scan après échec).
 */
export async function ensureCheckoutTierAvailable(
    tier: CheckoutTierId,
    opts: { bustCache?: boolean } = {},
): Promise<{ event: FestivalEvent; product: BilletterieProduct }> {
    if (opts.bustCache) clearBilletterieStorefrontCache();
    const data = await loadBilletterieStorefrontCached();
    const product = data.products.find((p) => productMatchesCheckoutTier(p, tier));
    if (product) return { event: data.event, product };

    if (await ticketTypeSoldOutForTier(tier)) {
        throw new SoldOutError(tier);
    }

    throw new Error(
        tier === 'student'
            ? 'Le Pass Festival n’est pas ouvert aux inscriptions pour le moment.'
            : 'Le Pass Nexus Night n’est pas ouvert aux inscriptions pour le moment.',
    );
}

/** @deprecated Préférer {@link ensureCheckoutTierAvailable} */
export async function resolveLiveCheckoutProduct(tier: CheckoutTierId): Promise<{
    event: FestivalEvent;
    product: BilletterieProduct;
}> {
    return ensureCheckoutTierAvailable(tier);
}
