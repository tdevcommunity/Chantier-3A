import test from 'node:test';
import assert from 'node:assert/strict';

import type { Participant } from '../types';
import {
  aggregateRegistrationInsights,
  filterParticipantsForInsights,
} from './registration-insights-aggregate.ts';

function baseParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'ord-1',
    ticket_id: 't-1',
    ticket_ids: ['t-1'],
    order_id: 'ord-1',
    name: 'Test User',
    first_name: 'Test',
    last_name: 'User',
    email: 'test@example.com',
    phone: '',
    city: 'Lomé',
    school: '',
    serial: 'TDEV-2026-0001',
    pass_name: 'Pass Festival',
    order_status: 'paid',
    amount_minor: 0,
    currency: 'XOF',
    issued_at: '2026-01-01T00:00:00Z',
    is_nexus: false,
    has_goodies: false,
    admitted: false,
    registration_form: {},
    ticket_statuses: ['valid'],
    is_revoked: false,
    ...overrides,
  };
}

test('filterParticipantsForInsights excludes revoked and failed in paid_valid mode', () => {
  const list = [
    baseParticipant({ id: 'a' }),
    baseParticipant({ id: 'b', order_status: 'pending' }),
    baseParticipant({ id: 'c', is_revoked: true, ticket_statuses: ['void'] }),
    baseParticipant({ id: 'd', order_status: 'failed' }),
  ];
  const filtered = filterParticipantsForInsights(list, 'paid_valid');
  assert.deepEqual(filtered.map((p) => p.id), ['a']);
});

test('aggregateRegistrationInsights counts single and multi choice fields', () => {
  const list = [
    baseParticipant({
      id: '1',
      registration_form: {
        gender: 'woman',
        participation_reasons: ['learn_skills', 'other'],
      },
    }),
    baseParticipant({
      id: '2',
      registration_form: {
        gender: 'man',
        participation_reasons: ['learn_skills'],
      },
    }),
  ];
  const result = aggregateRegistrationInsights(list, 'paid_valid');
  assert.equal(result.cohortSize, 2);

  const gender = result.fields.find((f) => f.field.key === 'gender');
  assert.ok(gender?.slices);
  const woman = gender.slices!.find((s) => s.name === 'Femme');
  assert.equal(woman?.value, 1);

  const motivations = result.fields.find((f) => f.field.key === 'participation_reasons');
  assert.ok(motivations?.multiBars);
  const learn = motivations.multiBars!.find((b) => b.name.includes('Apprendre'));
  assert.equal(learn?.count, 2);
  assert.equal(learn?.percent, 100);
});

test('aggregateRegistrationInsights handles empty cohort', () => {
  const result = aggregateRegistrationInsights([], 'paid_valid');
  assert.equal(result.cohortSize, 0);
  assert.ok(result.fields.length > 0);
});
