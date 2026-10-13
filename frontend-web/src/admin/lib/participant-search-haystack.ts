import {
  labelForChoice,
  labelsForChoices,
  registrationFormDisplayRows,
  AGE_RANGE_OPTIONS,
  DIGITAL_LEVEL_OPTIONS,
  DISCOVERY_CHANNEL_OPTIONS,
  GENDER_OPTIONS,
  PARTICIPATION_REASON_OPTIONS,
  PREFERRED_CHANNEL_OPTIONS,
  PRIOR_PARTICIPATION_OPTIONS,
  SITUATION_OPTIONS,
  TOPIC_OPTIONS,
} from '@/lib/registration-form';
import type { Participant } from '../types';

function formSearchText(form: Record<string, unknown>): string {
  const rows = registrationFormDisplayRows(form);
  const fromRows = rows.map((r) => r.value).join(' ');
  const reasons = Array.isArray(form.participation_reasons)
    ? labelsForChoices(PARTICIPATION_REASON_OPTIONS, form.participation_reasons as string[]).join(' ')
    : '';
  const topics = Array.isArray(form.topics)
    ? labelsForChoices(TOPIC_OPTIONS, form.topics as string[]).join(' ')
    : '';
  const extras = [
    labelForChoice(GENDER_OPTIONS, String(form.gender ?? '')),
    labelForChoice(AGE_RANGE_OPTIONS, String(form.age_range ?? '')),
    labelForChoice(SITUATION_OPTIONS, String(form.situation ?? '')),
    labelForChoice(DIGITAL_LEVEL_OPTIONS, String(form.digital_level ?? '')),
    labelForChoice(PRIOR_PARTICIPATION_OPTIONS, String(form.prior_participation ?? '')),
    labelForChoice(DISCOVERY_CHANNEL_OPTIONS, String(form.discovery_channel ?? '')),
    labelForChoice(PREFERRED_CHANNEL_OPTIONS, String(form.preferred_channel ?? '')),
    String(form.activity_domain ?? ''),
    String(form.school_program ?? ''),
    String(form.expectations ?? ''),
    String(form.want_to_meet ?? ''),
    String(form.referred_by ?? ''),
  ].join(' ');
  return [fromRows, reasons, topics, extras].join(' ');
}

export function participantSearchHaystack(p: Participant): string {
  const form = p.registration_form || {};
  return [
    p.name,
    p.first_name,
    p.last_name,
    p.email,
    p.phone,
    p.city,
    p.school,
    p.serial,
    p.pass_name,
    formSearchText(form),
  ]
    .join(' ')
    .toLowerCase();
}

export function participantMatchesSearch(p: Participant, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = participantSearchHaystack(p);
  return tokens.every((token) => hay.includes(token));
}
