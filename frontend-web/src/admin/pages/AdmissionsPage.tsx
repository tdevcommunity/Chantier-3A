import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Search,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { admissionsService } from '../services/admissions.service';
import { exportsService } from '../services/exports.service';
import { useToast } from '../context/ToastContext';
import { useEvent } from '../context/EventContext';
import { useOrgRole } from '../context/OrgRoleContext';
import { canExportAny } from '../lib/org-permissions';
import { adminUserMessage } from '../lib/admin-user-message';
import { formatDateTime } from '../lib/utils';
import { buildScannerUrl, serialSuffixFromDisplay } from '../lib/scanner-url';
import { Admission, AdmissionResult } from '../types';

const RESET_CONFIRM_TOKEN = 'REINITIALISER';
type ResetScope = 'all' | 'before_date' | 'ticket';

function todayDateInput(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const AdmissionsPage: React.FC = () => {
  const { eventId } = useEvent();
  const { orgRole } = useOrgRole();
  const showExports = canExportAny(orgRole);
  const canResetAdmissions = orgRole === 'owner' || orgRole === 'admin';
  const { success, error: showError } = useToast();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetScope, setResetScope] = useState<ResetScope>('all');
  const [resetBeforeDate, setResetBeforeDate] = useState<string>(todayDateInput);
  const [resetTicketId, setResetTicketId] = useState<string>('');
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [resultFilter, setResultFilter] = useState<AdmissionResult | 'all'>('all');

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
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
      if (!silent) {
        setError(adminUserMessage(err, 'Impossible de récupérer les admissions.'));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchTerm, resultFilter, eventId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadData(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadData(true);
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

  const admittedList = admissions.filter((a) => a.result === 'admitted');

  const openResetModal = () => {
    setResetScope('all');
    setResetBeforeDate(todayDateInput());
    setResetTicketId(admittedList[0]?.ticket_id ?? '');
    setResetConfirmInput('');
    setShowResetModal(true);
  };

  const canSubmitReset =
    !resetting &&
    resetConfirmInput.trim() === RESET_CONFIRM_TOKEN &&
    (resetScope === 'all' ||
      (resetScope === 'before_date' && Boolean(resetBeforeDate)) ||
      (resetScope === 'ticket' && Boolean(resetTicketId)));

  const handleResetAdmissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitReset) return;

    const options =
      resetScope === 'before_date'
        ? { beforeIso: new Date(`${resetBeforeDate}T00:00:00`).toISOString() }
        : resetScope === 'ticket'
          ? { ticketId: resetTicketId }
          : undefined;

    setResetting(true);
    try {
      const res = await admissionsService.resetAll(eventId, options);
      const total = Math.max(res.deleted_admissions, res.deleted_consumptions);
      setShowResetModal(false);
      setResetConfirmInput('');
      success(
        'Admissions réinitialisées',
        `${total} passage(s) réinitialisé(s). Les passes ciblés sont de nouveau valides pour le scan.`,
      );
      await loadData();
    } catch (err) {
      showError(
        'Réinitialisation impossible',
        adminUserMessage(err, 'Impossible de réinitialiser les admissions.'),
      );
    } finally {
      setResetting(false);
    }
  };

  const count = (result: AdmissionResult) => admissions.filter((admission) => admission.result === result).length;
  const scannerUrl = buildScannerUrl();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal des scans d’entrée"
        subtitle="Historique des admissions enregistrées au portique (lecture seule — pas d’admission depuis cette page)"
      >
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={scannerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-sm transition-all"
          >
            <QrCode className="w-4 h-4" />
            Ouvrir le scanner portique
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </a>
          {canResetAdmissions ? (
            <button
              type="button"
              onClick={openResetModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-xs font-semibold shadow-sm transition-all"
            >
              <RotateCcw className="w-4 h-4 text-slate-500" />
              Réinitialiser les admissions
            </button>
          ) : null}
          {showExports ? (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
            >
              <Download className="w-4 h-4 text-slate-500" />
              Exporter Journal CSV
            </button>
          ) : null}
        </div>
      </PageHeader>

      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-xs text-amber-950">
        <p className="font-semibold">Pour faire entrer quelqu’un sur le web</p>
        <p className="mt-1 text-amber-900/90 leading-relaxed">
          Utilisez le{' '}
          <a
            href={scannerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            scanner portique
          </a>{' '}
          : saisissez les 4 chiffres du pass (<span className="font-mono">TDEV-2026-XXXX</span>) ou
          recherchez par nom, puis confirmez l’admission. La recherche ci-dessous sert uniquement à
          consulter le journal ou repérer un inscrit{' '}
          <span className="font-medium">non composté</span> (filtre dédié).
        </p>
      </div>

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
            placeholder="Recherche journal : nom, e-mail, n° série…"
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
          <option value="not_scanned">Non composté (recherche)</option>
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
                  <th className="py-3.5 px-6 text-right">Action</th>
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
                      {a.result === 'not_scanned' ? (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          —
                        </span>
                      ) : (
                        formatDateTime(a.scanned_at)
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {a.result === 'not_scanned' ? (
                        <a
                          href={buildScannerUrl({
                            mode: 'serial',
                            suffix: serialSuffixFromDisplay(a.serial || ''),
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800"
                        >
                          Admettre
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Réinitialiser les admissions
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Choisissez le périmètre à réinitialiser. Les passes concernés perdront leur statut « Admis » et pourront être scannés à nouveau.
              </p>
            </div>

            <form onSubmit={handleResetAdmissions} className="space-y-3.5">
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="resetScope"
                    checked={resetScope === 'all'}
                    onChange={() => setResetScope('all')}
                    className="mt-0.5 accent-slate-900"
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Tout l’événement</div>
                    <div className="text-[11px] text-slate-500">Réinitialise tous les passes scannés jusqu’ici.</div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="resetScope"
                    checked={resetScope === 'before_date'}
                    onChange={() => setResetScope('before_date')}
                    className="mt-0.5 accent-slate-900"
                  />
                  <div className="flex-1 space-y-1.5">
                    <div className="text-xs font-semibold text-slate-800">Scannés avant une date</div>
                    <div className="text-[11px] text-slate-500">Ex. choisir aujourd’hui pour ne réinitialiser que ceux d’hier et avant.</div>
                    {resetScope === 'before_date' && (
                      <input
                        type="date"
                        value={resetBeforeDate}
                        onChange={(e) => setResetBeforeDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                        required
                      />
                    )}
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="resetScope"
                    checked={resetScope === 'ticket'}
                    onChange={() => setResetScope('ticket')}
                    className="mt-0.5 accent-slate-900"
                  />
                  <div className="flex-1 space-y-1.5">
                    <div className="text-xs font-semibold text-slate-800">Un seul participant / billet</div>
                    {resetScope === 'ticket' && (
                      admittedList.length > 0 ? (
                        <select
                          value={resetTicketId}
                          onChange={(e) => setResetTicketId(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                          required
                        >
                          {admittedList.map((a) => (
                            <option key={a.ticket_id} value={a.ticket_id}>
                              {a.holder_name || 'Sans nom'} — {a.serial || a.ticket_id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-[11px] text-slate-500">Aucun billet admis actuellement.</div>
                      )
                    )}
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Pour confirmer, saisissez ou collez{' '}
                  <code className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono font-bold text-slate-800 select-all">
                    {RESET_CONFIRM_TOKEN}
                  </code>{' '}
                  ci-dessous :
                </label>
                <input
                  type="text"
                  value={resetConfirmInput}
                  onChange={(e) => setResetConfirmInput(e.target.value)}
                  placeholder={RESET_CONFIRM_TOKEN}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetModal(false);
                    setResetConfirmInput('');
                  }}
                  disabled={resetting}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitReset}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 transition-all"
                >
                  {resetting ? 'Réinitialisation…' : 'Confirmer la réinitialisation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
