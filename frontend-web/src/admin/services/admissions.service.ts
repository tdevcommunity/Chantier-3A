import { apiFetch } from './api';
import { Admission, AdmissionResult } from '../types';
import { requireEventId } from '../context/EventContext';
import { admissionMatchesSearch } from '../lib/admission-search';
import { logAdminApiDiagnostic } from '../lib/user-facing-api-error';
import { participantMatchesSearch } from '../lib/participant-search-haystack';
import { participantsService } from './participants.service';

export const admissionsService = {
  async getAll(
    params: { result?: AdmissionResult | 'all'; search?: string } = {},
    eventId?: string | null,
  ): Promise<Admission[]> {
    const id = requireEventId(eventId ?? null);

    const [attendeesRes, conflictsRes, checkinRes] = await Promise.allSettled([
      apiFetch<{ attendees: Record<string, unknown>[] }>(`/events/${id}/attendees`),
      apiFetch<{ conflicts: Record<string, unknown>[] }>(`/events/${id}/admission-conflicts`),
      apiFetch<{ conflicts: Record<string, unknown>[] }>(
        `/checkin/conflicts?event_id=${encodeURIComponent(id)}&limit=200`,
      ),
    ]);

    const admissions: Admission[] = [];

    if (attendeesRes.status === 'fulfilled') {
      (attendeesRes.value.attendees || []).forEach((a) => {
        if (!a.admitted) return;
        admissions.push({
          id: String(a.ticket_id),
          ticket_id: String(a.ticket_id),
          event_id: id,
          gate_id: String(a.gate_id || 'Portique principal'),
          scanned_by: null,
          device_id: String(a.device_id || 'terminal-mobile'),
          scanned_at: String(a.scanned_at || a.admitted_at || new Date().toISOString()),
          result: 'admitted',
          note: String(a.control_type || ''),
          holder_name: String(a.holder_name || `${a.first_name} ${a.last_name}`.trim()),
          serial: String(a.serial),
          pass_name: String(a.ticket_type_name || a.pass_type || 'Pass Festival'),
        });
      });
    }

    if (conflictsRes.status === 'fulfilled') {
      (conflictsRes.value.conflicts || []).forEach((c, idx) => {
        admissions.push({
          id: String(c.ticket_id || `conflict-${idx}`),
          ticket_id: String(c.ticket_id || ''),
          event_id: id,
          gate_id: 'Portique',
          scanned_by: null,
          device_id: 'terminal',
          scanned_at: String(c.last_scanned_at || c.first_scanned_at || new Date().toISOString()),
          result: 'duplicate',
          note: String(c.control_type || 'Conflit multi-appareils'),
          holder_name: '',
          serial: '',
          pass_name: String(c.control_type || ''),
        });
      });
    }

    if (checkinRes.status === 'fulfilled') {
      (checkinRes.value.conflicts || []).forEach((c) => {
        admissions.push({
          id: String(c.conflict_id || c.id),
          ticket_id: String(c.ticket_id || ''),
          event_id: id,
          gate_id: String(c.station || 'Check-in'),
          scanned_by: null,
          device_id: String(c.terminal_id || 'terminal'),
          scanned_at: String(c.created_at || new Date().toISOString()),
          result: 'duplicate',
          note: String(c.type || c.status || ''),
          holder_name: '',
          serial: '',
          pass_name: String(c.type || 'Litige'),
          conflict_id: Number(c.conflict_id),
        } as Admission & { conflict_id?: number });
      });
    }

    admissions.sort(
      (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
    );

    const searchQuery = params.search?.trim() ?? '';
    const participantsByTicket = new Map<string, import('../types').Participant>();
    let allParticipants: import('../types').Participant[] = [];

    if (searchQuery) {
      try {
        const res = await participantsService.getAll(
          { paginate: false, includeRevoked: true },
          id,
        );
        allParticipants = res.data;
        for (const p of allParticipants) {
          for (const ticketId of p.ticket_ids) {
            participantsByTicket.set(ticketId, p);
          }
          participantsByTicket.set(p.ticket_id, p);
        }
      } catch (err) {
        logAdminApiDiagnostic('admissions-search-participants', err);
      }
    }

    let result = admissions;
    if (searchQuery) {
      result = result.filter((a) =>
        admissionMatchesSearch(a, searchQuery, participantsByTicket.get(a.ticket_id)),
      );

      const listedTickets = new Set(result.map((a) => a.ticket_id));
      for (const p of allParticipants) {
        if (!participantMatchesSearch(p, searchQuery)) continue;
        const alreadyListed = p.ticket_ids.some((tid) => listedTickets.has(tid));
        if (alreadyListed) continue;
        if (p.admitted) continue;

        result.push({
          id: `not-scanned-${p.id}`,
          ticket_id: p.ticket_id,
          event_id: id,
          gate_id: '—',
          scanned_by: null,
          device_id: '—',
          scanned_at: p.issued_at || new Date(0).toISOString(),
          result: 'not_scanned',
          note: 'Inscrit correspondant — aucun scan enregistré au portique',
          holder_name: p.name,
          serial: p.serial,
          pass_name: p.pass_name,
        });
        listedTickets.add(p.ticket_id);
      }

      result.sort(
        (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
      );
    }

    if (params.result && params.result !== 'all') {
      result = result.filter((a) => a.result === params.result);
    }
    return result;
  },

  async acknowledgeConflict(conflictId: number, note: string): Promise<void> {
    await apiFetch(`/checkin/conflicts/${conflictId}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },
};
