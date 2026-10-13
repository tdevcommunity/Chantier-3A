import { ExportEmptyError, exportToCsv } from '../lib/export';
import { downloadParticipantsRegistrationPdf } from '../lib/registration-export-pdf';
import { REGISTRATION_CSV_HEADERS, registrationRowForCsv } from '@/lib/registration-form';
import { participantsService } from './participants.service';
import { apiClient } from './api';
import { requireEventId } from '../context/EventContext';
import { ordersService } from './orders.service';
import { ticketsService } from './tickets.service';
import { admissionsService } from './admissions.service';

type ExportKind = 'participants' | 'tickets' | 'admissions' | 'orders';

const CSV_COLUMN_ORDER = Object.keys(REGISTRATION_CSV_HEADERS);

export const exportsService = {
  async exportParticipants(eventId: string | null) {
    const id = requireEventId(eventId ?? null);
    await apiClient.download(
      `/events/${id}/exports/participants.csv`,
      'tdev_inscriptions_complet.csv',
    );
  },

  async exportParticipantsPdf(eventId: string | null) {
    const { data } = await participantsService.getAll(
      { includeRevoked: true, paginate: false },
      eventId,
    );
    await downloadParticipantsRegistrationPdf(data);
  },

  async exportOrders(eventId: string | null, _format: 'csv' | 'excel' = 'csv') {
    const { data } = await ordersService.getAll({ limit: 100000 }, eventId);
    exportToCsv(
      'tdev_orders',
      data.map((o) => ({
        id: o.id,
        acheteur: o.buyer_name,
        email: o.buyer_email,
        statut: o.status,
        total: o.total_minor,
        devise: o.currency,
        cree_le: o.created_at,
      })),
    );
  },

  async exportTickets(eventId: string | null, _format: 'csv' | 'excel' = 'csv') {
    const data = await ticketsService.getAll({}, eventId);
    exportToCsv(
      'tdev_tickets',
      data.map((t) => ({
        serie: t.serial,
        detenteur: t.holder_name,
        statut: t.status,
        pass: t.ticket_type?.name,
        commande: t.order_id,
      })),
    );
  },

  async exportAdmissions(eventId: string | null, _format: 'csv' | 'excel' = 'csv') {
    const data = await admissionsService.getAll({}, eventId);
    exportToCsv(
      'tdev_admissions',
      data.map((a) => ({
        resultat: a.result,
        serie: a.serial,
        nom: a.holder_name,
        portique: a.gate_id,
        date: a.scanned_at,
        note: a.note,
      })),
    );
  },

  downloadServerCsv(kind: ExportKind, eventId: string | null) {
    switch (kind) {
      case 'participants':
        return this.exportParticipants(eventId);
      case 'orders':
        return this.exportOrders(eventId);
      case 'tickets':
        return this.exportTickets(eventId);
      case 'admissions':
        return this.exportAdmissions(eventId);
    }
  },
};
