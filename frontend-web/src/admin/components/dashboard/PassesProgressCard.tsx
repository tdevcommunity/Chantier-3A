import React from 'react';
import { Tag, ChevronRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminTheme } from '../../lib/admin-theme';
import { buildLandingPassStats, type LandingPassStatRow } from '../../lib/landing-pass-stats';
import { cn } from '../../lib/utils';
import type { TicketType } from '../../types';
import type { BilletterieCardAccent } from '@/lib/static-billetterie-catalog';

interface PassesProgressCardProps {
  ticketTypes: TicketType[];
}

function quotaPercent(sold: number, total: number, external: boolean): number {
  if (external) return 0;
  if (total <= 0) return sold > 0 ? 100 : 0;
  return Math.min(100, Math.round((sold / total) * 100));
}

function quotaCaption(row: LandingPassStatRow, percent: number): string {
  if (row.externalUrl) return 'Merch en ligne';
  if (row.total <= 0) return 'Places illimitées';
  return `${percent} %`;
}

function soldCaption(sold: number): string {
  if (sold <= 0) return '—';
  return sold > 0 ? 'Sans quota' : '—';
}

function soldDisplay(row: LandingPassStatRow): string {
  if (row.externalUrl && row.sold <= 0) return '—';
  if (row.total <= 0) return row.sold.toLocaleString('fr-FR');
  return `${row.sold.toLocaleString('fr-FR')} / ${row.total.toLocaleString('fr-FR')}`;
}

const ACCENT_RING: Record<BilletterieCardAccent, string> = {
  festival: 'ring-emerald-500/25 bg-emerald-50/80 text-emerald-800',
  nexus: 'ring-amber-500/30 bg-amber-50/90 text-amber-900',
  neutral: 'ring-zinc-200/90 bg-white text-zinc-600',
};

const ACCENT_BAR: Record<BilletterieCardAccent, string> = {
  festival: 'bg-emerald-600',
  nexus: 'bg-amber-600',
  neutral: 'bg-zinc-300',
};

export const PassesProgressCard: React.FC<PassesProgressCardProps> = ({ ticketTypes }) => {
  const items = buildLandingPassStats(ticketTypes);

  return (
    <section className={cn(adminTheme.card, 'p-5')}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className={adminTheme.cardTitle}>Offres du festival</h3>
          <p className={adminTheme.cardSubtitle}>
            Pass Festival et Nexus Night
          </p>
        </div>
        <Link
          to="ticket-types"
          className={cn('inline-flex shrink-0 items-center gap-1 text-xs', adminTheme.linkAccent)}
        >
          Détail des passes <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((row) => {
          const accent = row.cardAccent ?? 'neutral';
          const external = Boolean(row.externalUrl);
          const percent = quotaPercent(row.sold, row.total, external);

          return (
            <div
              key={row.listingId}
              className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4 transition-colors hover:border-zinc-200 hover:bg-zinc-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
                      ACCENT_RING[accent],
                    )}
                  >
                    <Tag className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{row.title}</p>
                    {row.subtitle ? (
                      <p className="truncate text-xs text-zinc-500">{row.subtitle}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs font-medium text-zinc-600">{row.priceLabel}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-zinc-900">{soldDisplay(row)}</p>
                  <p className="text-[11px] text-zinc-500">{quotaCaption(row, percent)}</p>
                </div>
              </div>

              {external ? (
                <a
                  href={row.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                >
                  {row.externalUrl ? new URL(row.externalUrl).host : 'Boutique'}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200/80">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', ACCENT_BAR[accent])}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
