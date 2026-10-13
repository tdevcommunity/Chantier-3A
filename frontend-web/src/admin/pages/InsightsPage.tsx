import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { useEvent } from '../context/EventContext';
import { participantsService } from '../services/participants.service';
import { adminUserMessage } from '../lib/admin-user-message';
import type { Participant } from '../types';
import {
  aggregateRegistrationInsights,
  type InsightsCohortMode,
} from '../lib/registration-insights-aggregate';
import { InsightChoiceChart } from '../components/insights/InsightChoiceChart';
import { InsightMultiBarChart } from '../components/insights/InsightMultiBarChart';
import { InsightTextList } from '../components/insights/InsightTextList';

export const InsightsPage: React.FC = () => {
  const { eventId } = useEvent();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cohortMode, setCohortMode] = useState<InsightsCohortMode>('paid_valid');

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
        setError(adminUserMessage(err, 'Impossible de charger les inscriptions.'));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [eventId]);

  const aggregate = useMemo(
    () => aggregateRegistrationInsights(participants, cohortMode),
    [participants, cohortMode],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights inscription"
        subtitle="Visualisation agrégée du formulaire participant (cohorte payée, billets valides par défaut)."
      >
        <span className="inline-flex items-center rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 border border-emerald-100">
          {aggregate.cohortSize} inscrit(s) analysé(s)
        </span>
        <select
          value={cohortMode}
          onChange={(e) => setCohortMode(e.target.value as InsightsCohortMode)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
        >
          <option value="paid_valid">Payés uniquement (billets valides)</option>
          <option value="non_failed">Tous sauf échoués</option>
        </select>
      </PageHeader>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {aggregate.fields.map((fieldResult) => {
            const { field } = fieldResult;
            if (field.kind === 'multi' && fieldResult.multiBars) {
              return (
                <InsightMultiBarChart
                  key={field.key}
                  title={field.label}
                  bars={fieldResult.multiBars}
                  respondents={fieldResult.totalRespondents}
                />
              );
            }
            if (field.kind === 'text' && fieldResult.textEntries) {
              return (
                <InsightTextList key={field.key} title={field.label} entries={fieldResult.textEntries} />
              );
            }
            if (fieldResult.slices) {
              return (
                <InsightChoiceChart
                  key={field.key}
                  title={field.label}
                  subtitle={
                    field.kind === 'geo'
                      ? `Top ${field.topN ?? 15} · ${fieldResult.totalRespondents} réponse(s) renseignée(s)`
                      : `${fieldResult.totalRespondents} réponse(s) renseignée(s)`
                  }
                  slices={fieldResult.slices}
                  total={aggregate.cohortSize}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};
