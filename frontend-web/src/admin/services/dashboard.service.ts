import { apiFetch } from './api';
import { DashboardKPIData, TicketType } from '../types';
import { requireEventId } from '../context/EventContext';

function isNexusPass(tt: { name?: string; pass_tier?: string | null }): boolean {
  const name = (tt.name || '').toLowerCase();
  return tt.pass_tier === 'vip' || name.includes('nexus');
}

function isNexusRowName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('nexus') || n.includes('vip');
}

function emptySalesWeek(): { date: string; tickets: number }[] {
  const counts: Record<string, number> = {};
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    counts[key] = 0;
  }
  return Object.entries(counts).map(([date, tickets]) => ({ date, tickets }));
}

export const dashboardService = {
  async getKPIs(eventId?: string | null): Promise<DashboardKPIData> {
    const id = requireEventId(eventId ?? null);
    const [statsSettled, ordersSettled, ttSettled] = await Promise.allSettled([
      apiFetch<{
        stats: {
          sold: number;
          revenue_minor: number;
          admitted: number;
          admitted_by_control?: Record<string, number>;
          by_type: {
            ticket_type_id: string;
            name: string;
            quantity_total: number;
            sold: number;
            revenue_minor: number;
            pass_tier?: string | null;
          }[];
        };
      }>(`/events/${id}/stats`),
      apiFetch<{ orders: { status: string }[] }>(`/events/${id}/orders`),
      apiFetch<{ ticket_types: TicketType[] }>(`/events/${id}/ticket-types`),
    ]);

    if (statsSettled.status === 'rejected') {
      throw statsSettled.reason;
    }
    const st = statsSettled.value.stats;

    const ticketTypes =
      ttSettled.status === 'fulfilled' ? ttSettled.value.ticket_types || [] : [];
    const typeById = new Map(ticketTypes.map((t) => [t.id, t]));

    let nexusCount = 0;
    let nexusRevenue = 0;
    let ticketsTotal = 0;
    for (const row of st.by_type || []) {
      ticketsTotal += row.quantity_total || 0;
      const tt = typeById.get(row.ticket_type_id);
      const nexus =
        (tt && isNexusPass(tt)) || isNexusRowName(row.name || '') || row.pass_tier === 'vip';
      if (nexus) {
        nexusCount += row.sold || 0;
        nexusRevenue += row.revenue_minor || 0;
      }
    }

    let pending = 0;
    if (ordersSettled.status === 'fulfilled') {
      pending = (ordersSettled.value.orders || []).filter((o) => o.status === 'pending').length;
    }

    const control = st.admitted_by_control || {};
    const scansTotal = Object.values(control).reduce((acc, n) => acc + (n || 0), 0);

    return {
      participants_count: st.sold,
      tickets_sold: st.sold,
      tickets_total: ticketsTotal,
      nexus_night_count: nexusCount,
      nexus_night_revenue_minor: nexusRevenue,
      admissions_count: st.admitted,
      scans_total: scansTotal || st.admitted,
      pending_orders_count: pending,
      revenue_minor: st.revenue_minor,
      currency: 'XOF',
    };
  },

  async getSalesChart(eventId?: string | null): Promise<{ date: string; tickets: number }[]> {
    const id = requireEventId(eventId ?? null);
    const base = emptySalesWeek();
    try {
      const res = await apiFetch<{ orders: { status: string; created_at: string }[] }>(
        `/events/${id}/orders`,
      );
      const counts: Record<string, number> = Object.fromEntries(base.map((r) => [r.date, 0]));
      const today = new Date();
      (res.orders || []).forEach((o) => {
        if (o.status !== 'paid' && o.status !== 'free_confirmed') return;
        const created = new Date(o.created_at);
        const diffDays = Math.floor((today.getTime() - created.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays < 7) {
          const key = created.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
          if (key in counts) counts[key]++;
        }
      });
      return Object.entries(counts).map(([date, tickets]) => ({ date, tickets }));
    } catch {
      return base;
    }
  },

  async getTicketDistribution(
    eventId?: string | null,
  ): Promise<{ name: string; value: number }[]> {
    const id = requireEventId(eventId ?? null);
    try {
      const res = await apiFetch<{ ticket_types: TicketType[] }>(`/events/${id}/ticket-types`);
      return (res.ticket_types || [])
        .filter((tt) => tt.product_kind === 'ticket' && (tt.quantity_sold || 0) > 0)
        .map((tt) => ({ name: tt.name, value: tt.quantity_sold || 0 }));
    } catch {
      const stats = await apiFetch<{
        stats: { by_type: { name: string; sold: number }[] };
      }>(`/events/${id}/stats`);
      return (stats.stats.by_type || [])
        .filter((row) => (row.sold || 0) > 0)
        .map((row) => ({ name: row.name, value: row.sold || 0 }));
    }
  },

  async getAdmissionStats(
    eventId?: string | null,
  ): Promise<{ name: string; count: number; fill: string }[]> {
    const id = requireEventId(eventId ?? null);
    const res = await apiFetch<{
      stats: { admitted: number; admitted_by_control?: Record<string, number> };
    }>(`/events/${id}/stats`);
    const control = res.stats.admitted_by_control || {};
    const labels: Record<string, { name: string; fill: string }> = {
      event_entry: { name: 'Entrée', fill: '#16a34a' },
      food_access: { name: 'Restauration', fill: '#059669' },
      merch_pickup: { name: 'Goodies', fill: '#f59e0b' },
      after_entry: { name: 'After', fill: '#8b5cf6' },
    };
    const rows = Object.entries(control).map(([key, count]) => ({
      name: labels[key]?.name || key,
      count: count || 0,
      fill: labels[key]?.fill || '#64748b',
    }));
    if (rows.length === 0 && res.stats.admitted > 0) {
      rows.push({ name: 'Admis', count: res.stats.admitted, fill: '#16a34a' });
    }
    return rows;
  },
};