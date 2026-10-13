import {
  REGISTRATION_CSV_HEADERS,
  registrationRowForCsv,
} from '@/lib/registration-form';
import type { Participant } from '../types';
import { formatDateTime } from './utils';

export type SubmissionColumnKey = keyof typeof REGISTRATION_CSV_HEADERS;

export const SUBMISSION_COLUMN_KEYS = Object.keys(
  REGISTRATION_CSV_HEADERS,
) as SubmissionColumnKey[];

export interface SubmissionTableRow {
  id: string;
  submittedAt: string;
  submittedAtLabel: string;
  cells: Record<SubmissionColumnKey, string>;
}

export function submissionRowFromParticipant(p: Participant): SubmissionTableRow {
  const cells = registrationRowForCsv({
    form: p.registration_form || {},
    passLabel: p.pass_name,
    serials: p.serial,
    orderStatus: p.is_revoked ? `${p.order_status} (retiré)` : p.order_status,
    fallbackName: p.name,
    fallbackEmail: p.email,
  }) as Record<SubmissionColumnKey, string>;

  return {
    id: p.id,
    submittedAt: p.issued_at,
    submittedAtLabel: formatDateTime(p.issued_at) || '—',
    cells,
  };
}

export function submissionColumnLabel(key: SubmissionColumnKey): string {
  return REGISTRATION_CSV_HEADERS[key];
}

export type SubmissionFilter = 'all' | 'paid' | 'revoked';

export function filterParticipantsForSubmissions(
  participants: Participant[],
  filter: SubmissionFilter,
): Participant[] {
  switch (filter) {
    case 'paid':
      return participants.filter((p) => p.order_status === 'paid' && !p.is_revoked);
    case 'revoked':
      return participants.filter((p) => p.is_revoked);
    default:
      return participants;
  }
}

export function submissionFilterCounts(participants: Participant[]): Record<SubmissionFilter, number> {
  return {
    all: participants.length,
    paid: participants.filter((p) => p.order_status === 'paid' && !p.is_revoked).length,
    revoked: participants.filter((p) => p.is_revoked).length,
  };
}
