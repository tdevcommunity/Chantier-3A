import { labelForChoice } from '@/lib/registration-form';
import type { Participant } from '../types';
import {
  INSIGHT_UNSET_LABEL,
  REGISTRATION_INSIGHT_FIELDS,
  type RegistrationInsightField,
} from './registration-insights-config';

export type InsightsCohortMode = 'paid_valid' | 'non_failed';

export interface InsightCountSlice {
  name: string;
  value: number;
  percent?: number;
}

export interface InsightMultiBar {
  name: string;
  count: number;
  percent: number;
}

export interface InsightTextEntry {
  text: string;
  participantId: string;
}

export interface FieldInsightResult {
  field: RegistrationInsightField;
  totalRespondents: number;
  slices?: InsightCountSlice[];
  multiBars?: InsightMultiBar[];
  textEntries?: InsightTextEntry[];
}

export interface InsightsAggregateResult {
  cohortSize: number;
  fields: FieldInsightResult[];
}

function participantHasValidTicket(p: Participant): boolean {
  if (p.is_revoked) return false;
  if (p.ticket_statuses?.length) {
    return p.ticket_statuses.some((s) => s === 'valid');
  }
  return true;
}

export function filterParticipantsForInsights(
  participants: Participant[],
  mode: InsightsCohortMode,
): Participant[] {
  return participants.filter((p) => {
    if (!participantHasValidTicket(p)) return false;
    if (mode === 'paid_valid') return p.order_status === 'paid';
    return p.order_status !== 'failed';
  });
}

function normalizeStayInformed(raw: unknown): string {
  if (raw === true || raw === 'yes') return 'yes';
  if (raw === false || raw === 'no') return 'no';
  return typeof raw === 'string' ? raw.trim() : '';
}

function readFieldValue(form: Record<string, unknown>, field: RegistrationInsightField): unknown {
  const raw = form[field.key];
  if (field.key === 'stay_informed') return normalizeStayInformed(raw);
  return raw;
}

function labelForSingleValue(field: RegistrationInsightField, value: string): string {
  if (!value) return INSIGHT_UNSET_LABEL;
  if (field.options) return labelForChoice(field.options, value);
  return value;
}

function aggregateSingleOrBoolean(
  field: RegistrationInsightField,
  cohort: Participant[],
): FieldInsightResult {
  const counts = new Map<string, number>();
  let answered = 0;

  for (const p of cohort) {
    const form = p.registration_form || {};
    const raw = readFieldValue(form, field);
    let key: string;
    if (field.kind === 'boolean') {
      if (raw === true) key = 'Oui';
      else if (raw === false) key = 'Non';
      else key = INSIGHT_UNSET_LABEL;
    } else {
      key = labelForSingleValue(field, String(raw ?? '').trim());
    }
    if (key !== INSIGHT_UNSET_LABEL) answered += 1;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = cohort.length;
  const slices: InsightCountSlice[] = [...counts.entries()]
    .map(([name, value]) => ({
      name,
      value,
      percent: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return { field, totalRespondents: answered, slices };
}

function aggregateMulti(field: RegistrationInsightField, cohort: Participant[]): FieldInsightResult {
  const optionLabels = new Map(
    (field.options ?? []).map((o) => [o.value, o.label] as const),
  );
  const counts = new Map<string, number>();
  let withSelection = 0;

  for (const p of cohort) {
    const form = p.registration_form || {};
    const raw = form[field.key];
    const values = Array.isArray(raw) ? (raw as string[]).filter(Boolean) : [];
    if (values.length > 0) withSelection += 1;
    for (const v of values) {
      const label = optionLabels.get(v) ?? v;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  const denom = withSelection || 1;
  const multiBars: InsightMultiBar[] = [...counts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      percent: Math.round((count / denom) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  return { field, totalRespondents: withSelection, multiBars };
}

function aggregateGeo(field: RegistrationInsightField, cohort: Participant[]): FieldInsightResult {
  const counts = new Map<string, number>();
  let answered = 0;
  const topN = field.topN ?? 15;

  for (const p of cohort) {
    const form = p.registration_form || {};
    const value = String(form[field.key] ?? '').trim();
    const key = value || INSIGHT_UNSET_LABEL;
    if (value) answered += 1;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restTotal = rest.reduce((sum, [, n]) => sum + n, 0);
  const entries = [...top];
  if (restTotal > 0) entries.push(['Autres', restTotal]);

  const total = cohort.length;
  const slices: InsightCountSlice[] = entries.map(([name, value]) => ({
    name,
    value,
    percent: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
  }));

  return { field, totalRespondents: answered, slices };
}

function aggregateText(field: RegistrationInsightField, cohort: Participant[]): FieldInsightResult {
  const textEntries: InsightTextEntry[] = [];
  for (const p of cohort) {
    const form = p.registration_form || {};
    const text = String(form[field.key] ?? '').trim();
    if (text) textEntries.push({ text, participantId: p.id });
  }
  return { field, totalRespondents: textEntries.length, textEntries };
}

export function aggregateRegistrationInsights(
  participants: Participant[],
  mode: InsightsCohortMode = 'paid_valid',
): InsightsAggregateResult {
  const cohort = filterParticipantsForInsights(participants, mode);
  const fields = REGISTRATION_INSIGHT_FIELDS.map((field) => {
    switch (field.kind) {
      case 'multi':
        return aggregateMulti(field, cohort);
      case 'text':
        return aggregateText(field, cohort);
      case 'geo':
        return aggregateGeo(field, cohort);
      default:
        return aggregateSingleOrBoolean(field, cohort);
    }
  });

  return { cohortSize: cohort.length, fields };
}
