import {
  getStaticBilletterieListing,
  type BilletterieListingProduct,
} from '@/lib/static-billetterie-catalog';
import type { TicketType } from '../types';

export interface LandingPassStatRow {
  listingId: string;
  title: string;
  subtitle?: string;
  priceLabel: string;
  cardAccent?: BilletterieListingProduct['cardAccent'];
  externalUrl?: string;
  sold: number;
  total: number;
  ticketTypeId?: string;
}

function isTicket(t: TicketType): boolean {
  return t.product_kind !== 'goodie' && t.product_kind !== 'option';
}

function ticketsOnly(types: TicketType[]): TicketType[] {
  return types.filter(isTicket);
}

function pickTicketForTier(types: TicketType[], tier: 'student' | 'vip'): TicketType | undefined {
  const candidates = ticketsOnly(types).filter(
    (t) => (t.pass_tier ?? '').toLowerCase() === tier,
  );
  if (candidates.length === 0) return undefined;
  if (tier === 'student') {
    return (
      candidates.find((t) => /festival/i.test(t.name)) ??
      candidates.find((t) => t.price_minor === 0) ??
      candidates[0]
    );
  }
  return (
    candidates.find((t) => /nexus/i.test(t.name)) ??
    candidates.find((t) => t.price_minor > 0) ??
    candidates[0]
  );
}

function statsFromType(tt: TicketType | undefined): Pick<LandingPassStatRow, 'sold' | 'total' | 'ticketTypeId'> {
  if (!tt) return { sold: 0, total: 0 };
  return {
    sold: tt.quantity_sold ?? 0,
    total: tt.quantity_total ?? 0,
    ticketTypeId: tt.id,
  };
}

function rowFromListing(
  listing: BilletterieListingProduct,
  ticketTypes: TicketType[],
): LandingPassStatRow {
  let tt: TicketType | undefined;
  if (listing.checkoutTier === 'student') tt = pickTicketForTier(ticketTypes, 'student');
  else if (listing.checkoutTier === 'vip') tt = pickTicketForTier(ticketTypes, 'vip');

  return {
    listingId: listing.listingId,
    title: listing.title,
    subtitle: listing.subtitle,
    priceLabel: listing.priceLabel,
    cardAccent: listing.cardAccent,
    externalUrl: listing.externalUrl,
    ...statsFromType(tt),
  };
}

/** Passes gérés dans la billetterie (hors merch / liens externes vitrine). */
export function buildLandingPassStats(ticketTypes: TicketType[]): LandingPassStatRow[] {
  return getStaticBilletterieListing()
    .filter((listing) => listing.checkoutTier)
    .map((listing) => rowFromListing(listing, ticketTypes));
}
