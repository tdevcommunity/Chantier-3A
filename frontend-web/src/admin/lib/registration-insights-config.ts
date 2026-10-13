import type { ChoiceOption } from '@/lib/registration-form';
import {
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

export type InsightFieldKind = 'single' | 'multi' | 'boolean' | 'text' | 'geo';

export interface RegistrationInsightField {
  key: string;
  label: string;
  kind: InsightFieldKind;
  options?: ChoiceOption[];
  topN?: number;
}

export const REGISTRATION_INSIGHT_FIELDS: RegistrationInsightField[] = [
  { key: 'age_range', label: "Tranche d'âge", kind: 'single', options: AGE_RANGE_OPTIONS },
  { key: 'gender', label: 'Genre', kind: 'single', options: GENDER_OPTIONS },
  { key: 'situation', label: 'Situation', kind: 'single', options: SITUATION_OPTIONS },
  { key: 'digital_level', label: 'Niveau numérique', kind: 'single', options: DIGITAL_LEVEL_OPTIONS },
  {
    key: 'prior_participation',
    label: 'Participation antérieure',
    kind: 'single',
    options: PRIOR_PARTICIPATION_OPTIONS,
  },
  {
    key: 'discovery_channel',
    label: 'Découverte du festival',
    kind: 'single',
    options: DISCOVERY_CHANNEL_OPTIONS,
  },
  {
    key: 'preferred_channel',
    label: 'Canal préféré',
    kind: 'single',
    options: PREFERRED_CHANNEL_OPTIONS,
  },
  { key: 'stay_informed', label: 'Restez informé(e)', kind: 'single', options: [
    { value: 'yes', label: 'Oui' },
    { value: 'no', label: 'Non' },
  ] },
  {
    key: 'participation_reasons',
    label: 'Motivations',
    kind: 'multi',
    options: PARTICIPATION_REASON_OPTIONS,
  },
  { key: 'topics', label: 'Sujets', kind: 'multi', options: TOPIC_OPTIONS },
  { key: 'consent_data_processing', label: 'Consentement données', kind: 'boolean' },
  { key: 'consent_marketing', label: 'Consentement marketing', kind: 'boolean' },
  { key: 'country', label: 'Pays', kind: 'geo', topN: 15 },
  { key: 'city', label: 'Ville', kind: 'geo', topN: 15 },
  { key: 'expectations', label: 'Attentes', kind: 'text' },
  { key: 'prior_liked', label: 'Apprécié lors des éditions passées', kind: 'text' },
  { key: 'want_to_meet', label: 'Profils à rencontrer', kind: 'text' },
  { key: 'referred_by', label: 'Recommandation', kind: 'text' },
  { key: 'activity_domain', label: "Domaine d'activité", kind: 'text' },
  { key: 'school_program', label: 'Établissement', kind: 'text' },
];

export const INSIGHT_CHART_PALETTE = [
  '#059669',
  '#0d9488',
  '#0891b2',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#84cc16',
] as const;

export const INSIGHT_UNSET_LABEL = 'Non renseigné';
export const INSIGHT_UNSET_COLOR = '#d4d4d8';
