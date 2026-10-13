import type { Admission } from '../types';
import type { Participant } from '../types';
import { participantMatchesSearch, participantSearchHaystack } from './participant-search-haystack';

export function admissionMatchesSearch(
  admission: Admission,
  query: string,
  participant?: Participant,
): boolean {
  const q = query.trim();
  if (!q) return true;

  if (participant && participantMatchesSearch(participant, q)) {
    return true;
  }

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const hay = [
    admission.holder_name,
    admission.serial,
    admission.gate_id,
    admission.device_id,
    admission.pass_name,
    admission.note,
    participant?.name,
    participant?.email,
    participant?.phone,
    participant?.city,
    participant ? participantSearchHaystack(participant) : '',
  ]
    .join(' ')
    .toLowerCase();

  return tokens.every((token) => hay.includes(token));
}
