import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Download,
  Eye,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { participantsService } from '../services/participants.service';
import { exportsService } from '../services/exports.service';
import { ExportEmptyError } from '../lib/export';
import { adminMessages, adminUserMessage } from '../lib/admin-user-message';
import { useToast } from '../context/ToastContext';
import { useEvent } from '../context/EventContext';
import { Participant } from '../types';

export const ParticipantsPage: React.FC = () => {
  const { eventId } = useEvent();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 10;

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await participantsService.getAll(
        {
          search: searchTerm,
          status: statusFilter,
          pass_tier: tierFilter,
          page,
          limit,
        },
        eventId,
      );
      setParticipants(res.data);
      setTotal(res.total);
    } catch (err: unknown) {
      const message = adminUserMessage(err, 'Erreur lors de la récupération des participants.');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchTerm, statusFilter, tierFilter, page, eventId]);

  const handleExportCsv = async () => {
    try {
      await exportsService.exportParticipants(eventId);
      success('Export CSV réussi', adminMessages.exportSuccess);
    } catch (err) {
      if (err instanceof ExportEmptyError) {
        toastError('Export', adminMessages.exportNone);
        return;
      }
      const msg =
        err instanceof Error && err.message === 'empty_export'
          ? adminMessages.exportNone
          : adminUserMessage(err, adminMessages.exportFailed);
      toastError('Export', msg);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await exportsService.exportParticipantsPdf(eventId);
      success('Export PDF réussi', 'Chaque inscription est détaillée dans le document.');
    } catch (err) {
      toastError('Export PDF', adminUserMessage(err, adminMessages.exportFailed));
    } finally {
      setExportingPdf(false);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inscriptions participants"
        subtitle="Aperçu rapide : consultez une fiche ou exportez le formulaire complet (CSV ou PDF)."
      >
        <button
          onClick={() => void handleExportCsv()}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
        >
          <Download className="w-4 h-4 text-slate-500" />
          Export CSV complet
        </button>

        <button
          onClick={() => void handleExportPdf()}
          disabled={exportingPdf}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold shadow-sm transition-all"
        >
          <FileText className="w-4 h-4" />
          {exportingPdf ? 'Génération…' : 'Export PDF complet'}
        </button>
      </PageHeader>

      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Rechercher par nom ou e-mail…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
          >
            <option value="all">Tous statuts</option>
            <option value="paid">Payé</option>
            <option value="pending">En attente</option>
            <option value="refunded">Remboursé</option>
            <option value="failed">Échoué</option>
          </select>

          <select
            value={tierFilter}
            onChange={(e) => {
              setTierFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
          >
            <option value="all">Tous les passes</option>
            <option value="student">Pass Festival</option>
            <option value="vip">Nexus Night</option>
            <option value="standard">Standard</option>
          </select>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : participants.length === 0 ? (
        <EmptyState
          title="Aucune inscription trouvée"
          description="Modifiez la recherche ou les filtres pour afficher les participants."
          actionText="Réinitialiser les filtres"
          onAction={() => {
            setSearchTerm('');
            setStatusFilter('all');
            setTierFilter('all');
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-5">Nom</th>
                  <th className="py-3.5 px-5">E-mail</th>
                  <th className="py-3.5 px-5">Type de pass</th>
                  <th className="py-3.5 px-5">N° série</th>
                  <th className="py-3.5 px-5">Ville</th>
                  <th className="py-3.5 px-5">Statut</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {participants.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => navigate(`/participants/${p.id}`)}
                  >
                    <td className="py-4 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center text-xs shrink-0">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-bold text-slate-900 group-hover:text-violet-600 transition-colors">
                          {p.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-slate-600">{p.email}</td>
                    <td className="py-4 px-5 font-semibold text-slate-900">{p.pass_name}</td>
                    <td className="py-4 px-5 font-mono text-[11px] text-slate-500">{p.serial}</td>
                    <td className="py-4 px-5 text-slate-600">{p.city || '—'}</td>
                    <td className="py-4 px-5">
                      <StatusBadge status={p.order_status} type="order" />
                    </td>
                    <td className="py-4 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => navigate(`/participants/${p.id}`)}
                          className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Voir le formulaire complet"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => navigate(`/orders/${p.order_id}`)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Voir la commande"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div>
              Affichage {(page - 1) * limit + 1} à {Math.min(page * limit, total)} sur {total} inscriptions
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <span className="px-3 py-1.5 font-bold text-violet-600 bg-violet-50 rounded-lg">
                Page {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || totalPages === 0}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
