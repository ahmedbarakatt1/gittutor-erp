import { expect, test } from 'vitest';
import { workflowOperationsSchema, workflowReviewInputSchema } from '../../src/modules/workflow-import/operational-model';

const id = 'd3c78931-96e2-4d52-9860-0ac8ab952a40';
const record = { id, title: 'Synthetic learner', subtitle: 'Reported session', source_table: 'sessions', source_row: 2, reported_status: 'Completed', date: '2026-10-20', fields: [{ key: 'course', label: 'Course', value: 'Synthetic course', type: 'text' }], issues: [], actions: [], review: { version: 1, state: 'linked', can_review: false }, links: { learner_id: id, tutor_id: null, occurrence_id: null, package_id: null } };
const customer = { enabled: true, role: 'customer', mapping_options: { learners: [], tutors: [] }, sections: [{ key: 'sessions', title: 'Sessions', description: 'Workbook reports', metrics: [], records: [record] }] };

test('accepts a scoped reported customer view without requiring invented facts', () => {
  expect(workflowOperationsSchema.parse(customer)).toEqual(customer);
  expect(workflowOperationsSchema.parse({ enabled: false })).toEqual({ enabled: false });
});
test('rejects privileged customer fields, hidden raw snapshots and external actions', () => {
  expect(workflowOperationsSchema.safeParse({ ...customer, snapshot: {} }).success).toBe(false);
  for (const key of ['tutor_fee_due_minor', 'notes', 'margin_minor', 'payout_destination']) {
    const unsafe = structuredClone(customer); unsafe.sections[0].records[0].fields[0].key = key;
    expect(workflowOperationsSchema.safeParse(unsafe).success).toBe(false);
  }
  const external = structuredClone(customer) as typeof customer & { sections: Array<{ records: Array<{ actions: Array<{label: string; href: string}> }> }> };
  external.sections[0].records[0].actions.push({ label: 'Open', href: 'https://example.test' });
  expect(workflowOperationsSchema.safeParse(external).success).toBe(false);
});
test('customer views cannot expose mapping choices or owner review controls', () => {
  expect(workflowOperationsSchema.safeParse({ ...customer, mapping_options: { learners: [{ id, display_name: 'Other learner' }], tutors: [] } }).success).toBe(false);
  const unsafe = structuredClone(customer); unsafe.sections[0].records[0].review.can_review = true;
  expect(workflowOperationsSchema.safeParse(unsafe).success).toBe(false);
});
test('customer metric allowlist rejects compensation even when its label is innocuous', () => {
  const unsafe = { ...customer, sections: [{ ...customer.sections[0], metrics: [{ key: 'tutor_fee_due_minor', label: 'Total', value: 123, unit: 'money', basis: 'legacy_reported' }] }] };
  expect(workflowOperationsSchema.safeParse(unsafe).success).toBe(false);
});
test('review input preserves omitted links and rejects financial or arbitrary mutations', () => {
  const input = { link_id: id, expected_version: 1, review_state: 'reviewed', links: { learner_id: id }, reason: 'Source mapping independently checked', idempotency_key: 'synthetic-review-1' };
  expect(workflowReviewInputSchema.parse(input)).toEqual(input);
  expect(workflowReviewInputSchema.safeParse({ ...input, settled: true }).success).toBe(false);
  expect(workflowReviewInputSchema.safeParse({ ...input, links: { account_id: id } }).success).toBe(false);
});
