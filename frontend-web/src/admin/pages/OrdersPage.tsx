import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  Search,
  Download,
  Eye,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { ordersService } from '../services/orders.service';
import { exportsService } from '../services/exports.service';
import { useToast } from '../context/ToastContext';
import { adminUserMessage } from '../lib/admin-user-message';
import { formatMoney, formatDateTime } from '../lib/utils';
import { Order, OrderStatus } from '../types';
import { useEvent } from '../context/EventContext';

export const OrdersPage: React.FC = () => {
  const { eventId } = useEvent();
  const navigate = useNavigate();
  const { success } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const limit = 10;

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await ordersService.getAll(
        {
          search: searchTerm,
          status: statusFilter,
          page,
          limit,
        },
        eventId,
      );
      setOrders(res.data);
      setTotal(res.total);
    } catch (err: any) {
      setError(adminUserMessage(err, 'Erreur lors de la récupération des commandes.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchTerm, statusFilter, page, eventId]);

  const handleExportCsv = async () => {
    await exportsService.exportOrders(eventId);
    success('Export CSV réussi', 'Le fichier CSV des commandes a été téléchargé.');
  };

  const handleExportExcel = async () => {
    await exportsService.exportOrders(eventId);
    success('Export Excel réussi', 'Le fichier Excel des commandes a été généré.');
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion des Commandes"
        subtitle="Suivez les flux de réservations, états de transaction et paiements"
      >
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
        >
          <Download className="w-4 h-4 text-slate-500" />
          Exporter CSV
        </button>

        <button
          onClick={handleExportExcel}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm transition-all"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Exporter Excel
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher par ID, nom d'acheteur, e-mail, référence..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as any);
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="all">Tous les statuts</option>
          <option value="paid">Payé</option>
          <option value="pending">En attente</option>
          <option value="refunded">Remboursé</option>
          <option value="failed">Échoué</option>
          <option value="cancelled">Annulé</option>
        </select>
      </div>

      {/* Main Table */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : orders.length === 0 ? (
        <EmptyState
          title="Aucune commande trouvée"
          description="Ajustez vos filtres de recherche pour afficher les commandes."
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-5">ID Commande</th>
                  <th className="py-3.5 px-5">Participant</th>
                  <th className="py-3.5 px-5">Montant</th>
                  <th className="py-3.5 px-5">Fournisseur</th>
                  <th className="py-3.5 px-5">Réf Paiement</th>
                  <th className="py-3.5 px-5">Statut</th>
                  <th className="py-3.5 px-5">Date Création</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => navigate(`orders/${o.id}`)}
                  >
                    <td className="py-4 px-5 font-mono font-bold text-violet-600">
                      {o.id}
                    </td>

                    <td className="py-4 px-5">
                      <span className="font-bold text-slate-900 block group-hover:text-violet-600 transition-colors">
                        {o.buyer_name || 'Anonyme'}
                      </span>
                      <span className="text-[11px] text-slate-400">{o.buyer_email}</span>
                    </td>

                    <td className="py-4 px-5 font-bold text-slate-900">
                      {formatMoney(o.total_minor, o.currency)}
                    </td>

                    <td className="py-4 px-5 capitalize font-medium text-slate-600">
                      {o.provider || '—'}
                    </td>

                    <td className="py-4 px-5 font-mono text-[11px] text-slate-500">
                      {o.provider_ref || '—'}
                    </td>

                    <td className="py-4 px-5">
                      <StatusBadge status={o.status} type="order" />
                    </td>

                    <td className="py-4 px-5 text-slate-500">
                      {formatDateTime(o.created_at)}
                    </td>

                    <td className="py-4 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate(`orders/${o.id}`)}
                        className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Consulter"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div>
              Affichage {(page - 1) * limit + 1} à {Math.min(page * limit, total)} sur {total} commandes
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
