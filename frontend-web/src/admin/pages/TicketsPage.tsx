import React, { useState, useEffect } from 'react';
import {
  Ticket as TicketIcon,
  Search,
  Download,
  Mail,
  FileDown,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { ticketsService } from '../services/tickets.service';
import { exportsService } from '../services/exports.service';
import { useToast } from '../context/ToastContext';
import { useEvent } from '../context/EventContext';
import { adminUserMessage } from '../lib/admin-user-message';
import { formatDateTime } from '../lib/utils';
import { Ticket, TicketStatus } from '../types';

export const TicketsPage: React.FC = () => {
  const { eventId } = useEvent();
  const { success, error: toastError } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await ticketsService.getAll({
        status: statusFilter,
        search: searchTerm,
      }, eventId);
      setTickets(data);
    } catch (err: any) {
      setError(adminUserMessage(err, 'Impossible de récupérer les billets.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchTerm, statusFilter, eventId]);

  const handleResend = async (ticketId: string, serial: string) => {
    try {
      await ticketsService.resendEmail(ticketId);
      success('E-mail envoyé', `Billet ${serial} : renvoi en cours.`);
    } catch {
      toastError('Envoi impossible', 'Le billet n’a pas pu être renvoyé.');
    }
  };

  const handleExport = async () => {
    await exportsService.exportTickets(eventId);
    success('Export CSV réussi', 'Le fichier des billets a été téléchargé.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion des Billets Électroniques"
        subtitle="Contrôlez les séries de billets, leur validité et leur état d’activation"
      >
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
        >
          <Download className="w-4 h-4 text-slate-500" />
          Exporter CSV
        </button>
      </PageHeader>

      {/* Filter and search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher par numéro de série ou nom du détenteur..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="all">Tous les états</option>
          <option value="valid">Valide</option>
          <option value="void">Annulé / Invalide</option>
          <option value="refunded">Remboursé</option>
        </select>
      </div>

      {loading ? (
        <TableSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : tickets.length === 0 ? (
        <EmptyState title="Aucun billet trouvé pour ces critères." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Numéro de Série</th>
                  <th className="py-3.5 px-6">Détenteur</th>
                  <th className="py-3.5 px-6">Type de Pass</th>
                  <th className="py-3.5 px-6">Statut</th>
                  <th className="py-3.5 px-6">Date d'Émission</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-violet-700">
                      {t.serial}
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-900">
                      {t.holder_name}
                    </td>
                    <td className="py-4 px-6 text-slate-700 font-medium">
                      {t.ticket_type?.name || 'Pass Festival'}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={t.status} type="ticket" />
                    </td>
                    <td className="py-4 px-6 text-slate-500">
                      {formatDateTime(t.issued_at)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleResend(t.id, t.serial)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg border border-emerald-200 transition-colors"
                          title="Renvoyer le billet par e-mail"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Renvoyer
                        </button>
                        <button
                          onClick={() => {
                            ticketsService.downloadPdf(t.id)
                              .then(() => success('PDF téléchargé', `Billet ${t.serial} téléchargé.`))
                              .catch(() => toastError('PDF indisponible', 'Le billet n\'a pas pu être généré.'));
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-violet-600 hover:bg-violet-50 rounded-lg border border-violet-200 transition-colors"
                          title="Télécharger le PDF"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
