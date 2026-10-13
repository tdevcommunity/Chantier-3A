import { apiFetch } from './api';
import { Participant, OrderStatus, PassTier, TicketStatus } from '../types';
import { requireEventId } from '../context/EventContext';
import { participantMatchesSearch } from '../lib/participant-search-haystack';

export interface ParticipantFilterParams {
  search?: string;
  status?: string;
  pass_tier?: string;
  nexus?: boolean;
  page?: number;
  limit?: number;
  /** Inclure les inscrits dont les billets sont invalidés (retrait). Défaut : false. */
  includeRevoked?: boolean;
  /** Désactive la pagination (Insights, recherche par id). */
  paginate?: boolean;
}

type OrderRegistrationApi = {
  first_name?: string;
  last_name?: string;
  email?: string;
  school_name?: string;
  motivation?: string;
  wish?: string;
  form?: Record<string, unknown>;
};

function isNexusName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('nexus') || n.includes('vip');
}

function parseRegistration(order: Record<string, unknown>): OrderRegistrationApi {
  const reg = (order.registration as OrderRegistrationApi) || {};
  let form =
    reg.form && typeof reg.form === 'object' && !Array.isArray(reg.form)
      ? (reg.form as Record<string, unknown>)
      : {};
  const topLevel = order.registration_form;
  if (
    Object.keys(form).length === 0 &&
    topLevel &&
    typeof topLevel === 'object' &&
    !Array.isArray(topLevel)
  ) {
    form = topLevel as Record<string, unknown>;
  }
  return { ...reg, form };
}

function ticketStatusFromRow(t: Record<string, unknown>): TicketStatus {
  const s = String(t.status || 'valid');
  if (s === 'void' || s === 'refunded') return s;
  return 'valid';
}

export const participantsService = {
  async getAll(
    params: ParticipantFilterParams = {},
    eventId?: string | null,
  ): Promise<{ data: Participant[]; total: number }> {
    const id = requireEventId(eventId ?? null);
    const [attendeesRes, ordersRes] = await Promise.all([
      apiFetch<{ attendees: Record<string, unknown>[] }>(`/events/${id}/attendees`),
      apiFetch<{ orders: Record<string, unknown>[] }>(`/events/${id}/orders`),
    ]);

    const orderById = new Map(
      (ordersRes.orders || []).map((o) => [String(o.id), o as Record<string, unknown>]),
    );

    const ticketsByOrder = new Map<string, Record<string, unknown>[]>();
    for (const a of attendeesRes.attendees || []) {
      const orderId = String(a.order_id);
      const list = ticketsByOrder.get(orderId) || [];
      list.push(a);
      ticketsByOrder.set(orderId, list);
    }

    let participants: Participant[] = [];

    for (const [orderId, tickets] of ticketsByOrder) {
      const order = orderById.get(orderId) || {};
      const reg = parseRegistration(order);
      const form = reg.form || {};
      const passNames = [...new Set(tickets.map((t) => String(t.ticket_type_name || t.pass_type || 'Pass Festival')))];
      const serials = tickets.map((t) => String(t.serial || '')).filter(Boolean);
      const ticketStatuses = tickets.map((t) => ticketStatusFromRow(t));
      const isRevoked =
        ticketStatuses.length > 0 && ticketStatuses.every((s) => s !== 'valid');
      const primary = tickets[0]!;
      const passName = passNames.join(' + ');
      const firstName = String(form.first_name || reg.first_name || primary.first_name || '');
      const lastName = String(form.last_name || reg.last_name || primary.last_name || '');
      const displayName =
        `${firstName} ${lastName}`.trim() ||
        String(primary.holder_name || '').trim() ||
        String(order.buyer_name || '');

      participants.push({
        id: orderId,
        ticket_id: String(primary.ticket_id),
        ticket_ids: tickets.map((t) => String(t.ticket_id)),
        order_id: orderId,
        name: displayName,
        first_name: firstName,
        last_name: lastName,
        email: String(form.email || reg.email || primary.email || order.buyer_email || ''),
        phone: String(form.phone ?? ''),
        city: String(form.city ?? ''),
        school: String(form.school_program || reg.school_name || primary.school_name || ''),
        serial: serials.join(', '),
        pass_name: passName,
        pass_tier: ((primary.pass_type as string) || null) as PassTier | null,
        order_status: String(order.status || '') as OrderStatus,
        amount_minor: Number(order.total_minor || 0),
        currency: String(order.currency || 'XOF'),
        issued_at: String(order.paid_at || order.created_at || primary.scanned_at || ''),
        is_nexus: passNames.some((n) => isNexusName(n)),
        has_goodies: passName.toLowerCase().includes('goodies') || passName.toLowerCase().includes('welcome'),
        goodies_details: undefined,
        admitted: tickets.some((t) => Boolean(t.admitted)),
        registration_form: form,
        ticket_statuses: ticketStatuses,
        is_revoked: isRevoked,
      });
    }

    participants.sort((a, b) => b.issued_at.localeCompare(a.issued_at));

    const includeRevoked = params.includeRevoked === true;
    if (!includeRevoked) {
      participants = participants.filter((p) => !p.is_revoked);
    }

    if (params.search?.trim()) {
      participants = participants.filter((p) => participantMatchesSearch(p, params.search!));
    }
    if (params.status && params.status !== 'all') {
      participants = participants.filter((p) => p.order_status === params.status);
    }
    if (params.pass_tier && params.pass_tier !== 'all') {
      participants = participants.filter((p) => p.pass_tier === params.pass_tier);
    }
    if (params.nexus !== undefined) {
      participants = participants.filter((p) => p.is_nexus === params.nexus);
    }

    const total = participants.length;
    if (params.paginate === false) {
      return { data: participants, total };
    }
    const page = params.page || 1;
    const limit = params.limit || 10;
    const data = participants.slice((page - 1) * limit, page * limit);
    return { data, total };
  },

  async getById(participantId: string, eventId?: string | null): Promise<Participant | null> {
    const all = await this.getAll({ includeRevoked: true, paginate: false }, eventId);
    return (
      all.data.find(
        (p) =>
          p.id === participantId ||
          p.order_id === participantId ||
          p.ticket_id === participantId ||
          p.ticket_ids.includes(participantId),
      ) || null
    );
  },
};
