import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { SubmissionsTable } from '../components/submissions/SubmissionsTable';
import { useEvent } from '../context/EventContext';
import { participantsService } from '../services/participants.service';
import { exportsService } from '../services/exports.service';
import { ExportEmptyError } from '../lib/export';
import { adminMessages, adminUserMessage } from '../lib/admin-user-message';
import { useToast } from '../context/ToastContext';
import type { Participant } from '../types';
import {
  filterParticipantsForSubmissions,
  submissionFilterCounts,
  submissionRowFromParticipant,
  type SubmissionFilter,
} from '../lib/registration-submissions';
import { cn } from '../lib/utils';

const FILTER_LABELS: Record<SubmissionFilter, string> = {
  all: 'Toutes',
  paid: 'Payées',
  revoked: 'Retirées',
};

export const SubmissionsPage: React.FC = () => {
  const { eventId } = useEvent();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SubmissionFilter>('paid');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await participantsService.getAll(
          { includeRevoked: true, paginate: false },
          eventId,
        );
        setParticipants(res.data);
      } catch (err: unknown) {
        setError(adminUserMessage(err, 'Impossible de charger les soumissions.'));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [eventId]);

  const counts = useMemo(() => submissionFilterCounts(participants), [participants]);

  const rows = useMemo(() => {
    const filtered = filterParticipantsForSubmissions(participants, filter);
    return filtered
      .slice()
      .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
      .map(submissionRowFromParticipant);
  }, [participants, filter]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await exportsService.exportParticipants(eventId);
      success('Export CSV', adminMessages.exportSuccess);
    } catch (err) {
      if (err instanceof ExportEmptyError) {
        toastError('Export', adminMessages.exportNone);
        return;
      }
      toastError('Export', adminUserMessage(err, adminMessages.exportFailed));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Soumissions"
        subtitle="Tableau complet des réponses au formulaire d’inscription (défilement horizontal pour voir toutes les colonnes)."
      >
        <button
          type="button"
          onClick={() => void handleExportCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all disabled:opacity-60"
        >
          <Download className="w-4 h-4 text-slate-500" />
          {exporting ? 'Export…' : 'Télécharger CSV'}
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {(Object.keys(FILTER_LABELS) as SubmissionFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'font-semibold transition-colors pb-1 border-b-2 -mb-[13px]',
                filter === key
                  ? 'text-zinc-900 border-zinc-900'
                  : 'text-zinc-500 border-transparent hover:text-zinc-700',
              )}
            >
              {FILTER_LABELS[key]}{' '}
              <span className="text-zinc-400 font-medium">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={10} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucune soumission"
          description="Modifiez le filtre ou attendez les premières inscriptions payées."
          actionText="Voir toutes"
          onAction={() => setFilter('all')}
        />
      ) : (
        <SubmissionsTable rows={rows} onRowClick={(id) => navigate(`/participants/${id}`)} />
      )}
    </div>
  );
};
