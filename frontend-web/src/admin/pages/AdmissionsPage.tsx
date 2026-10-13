import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Search,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { admissionsService } from '../services/admissions.service';
import { exportsService } from '../services/exports.service';
import { useToast } from '../context/ToastContext';
import { useEvent } from '../context/EventContext';
import { adminUserMessage } from '../lib/admin-user-message';
import { formatDateTime } from '../lib/utils';
import { Admission, AdmissionResult } from '../types';

export const AdmissionsPage: React.FC = () => {
  const { eventId } = useEvent();
  const { success } = useToast();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [resultFilter, setResultFilter] = useState<AdmissionResult | 'all'>('all');

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await admissionsService.getAll(
        {
          result: resultFilter,
          search: searchTerm,
        },
        eventId,
      );
      setAdmissions(data);
    } catch (err: unknown) {
      setError(adminUserMessage(err, 'Impossible de récupérer les admissions.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchTerm, resultFilter, eventId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadData();
    }, 10000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [searchTerm, resultFilter, eventId]);

  const handleExport = async () => {
    await exportsService.exportAdmissions(eventId);
    success('Export CSV réussi', 'Le journal des scans d’admission a été téléchargé.');
  };

  const count = (result: AdmissionResult) => admissions.filter((admission) => admission.result === result).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contrôle des Admissions & Scans d’Entrée"
        subtitle="Historique temps réel des scans QR code aux portiques et terminaux mobiles"
      >
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
        >
          <Download className="w-4 h-4 text-slate-500" />
          Exporter Journal CSV
        </button>
      </PageHeader>

      {/* 4 Stats Cards (Section 16 requirement) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Admis"
          value={count('admitted')}
          icon={<CheckCircle2 className="w-5 h-5 text-white" />}
          iconBgColor="bg-green-800"
          subtitle={<span className="text-slate-500">Accès autorisé avec succès</span>}
        />

        <StatCard
          title="Doublons Détectés"
          value={count('duplicate')}
          icon={<AlertTriangle className="w-5 h-5 text-white" />}
          iconBgColor="bg-green-700"
          subtitle={<span className="text-slate-500">Billet scanné une 2nde fois</span>}
        />

        <StatCard
          title="Invalides"
          value={count('invalid')}
          icon={<XCircle className="w-5 h-5 text-white" />}
          iconBgColor="bg-green-600"
          subtitle={<span className="text-slate-500">Signature corrompue / faux</span>}
        />

        <StatCard
          title="Mauvais Événement"
          value={count('wrong_event')}
          icon={<HelpCircle className="w-5 h-5 text-white" />}
          iconBgColor="bg-green-500"
          subtitle={<span className="text-slate-500">Pass associé à un autre event</span>}
        />
      </div>

      {/* Filter bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Nom, e-mail, n° série, portique, terminal…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
          />
        </div>

        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as any)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="all">Tous les résultats</option>
          <option value="admitted">Admis</option>
          <option value="duplicate">Doublon</option>
          <option value="invalid">Invalide</option>
          <option value="wrong_event">Mauvais événement</option>
        </select>
      </div>

      {/* Admissions Table */}
      {loading ? (
        <TableSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : admissions.length === 0 ? (
        <EmptyState title="Aucun scan trouvé pour ces critères." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Billet / Série</th>
                  <th className="py-3.5 px-6">Détenteur</th>
                  <th className="py-3.5 px-6">Portique / Gate</th>
                  <th className="py-3.5 px-6">Terminal Scan</th>
                  <th className="py-3.5 px-6">Résultat</th>
                  <th className="py-3.5 px-6">Remarque / Diagnostic</th>
                  <th className="py-3.5 px-6 text-right">Date & Heure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {admissions.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-violet-700">
                      {a.serial || 'N/A'}
                    </td>
                    <td className="py-4 px-6 font-bold text-slate-900">
                      {a.holder_name || 'Inconnu'}
                    </td>
                    <td className="py-4 px-6 text-slate-700 font-medium">
                      {a.gate_id}
                    </td>
                    <td className="py-4 px-6 font-mono text-[11px] text-slate-500">
                      {a.device_id}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={a.result} type="admission" />
                    </td>
                    <td className="py-4 px-6 text-slate-600 max-w-xs truncate">
                      {a.note || '—'}
                    </td>
                    <td className="py-4 px-6 text-right text-slate-500 font-medium">
                      {formatDateTime(a.scanned_at)}
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
