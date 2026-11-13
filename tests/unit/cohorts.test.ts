import { describe, expect, test } from 'vitest';
import { acquisitionCost, buildCohort, cohortConversionRate, type AcquisitionInput } from '../../src/modules/analytics/acquisition';
import { tutorSeconds } from '../../src/modules/analytics/workload';
import { analyticsCommands, cohortCsv, cohortRow } from '../../src/modules/analytics/queries';

const input = (): AcquisitionInput => ({
  from: '2026-08-01', to: '2026-08-31', as_of: '2026-11-12T00:00:00Z', observation_days: 30,
  inquiries: [{ id: 'a', learner_id: 'one', observed_at: '2026-08-31T20:59:59Z', recorded_at: '2026-08-31T20:59:59Z', attribution: 'unknown', campaign_id: null }],
  attendance: [], histories: [{ learner_id: 'one', complete: true }], bookings: [], payments: [],
});
describe('lifetime acquisition cohorts', () => {
  test('GT-1001/1002/1507 lifetime first inquiry precedes Cairo period filtering; repeat contacts retain one learner', () => {
    const data = input(); data.inquiries.push({ ...data.inquiries[0], id: 'b', observed_at: '2026-08-31T21:00:00Z' }, { ...data.inquiries[0], id: 'c', observed_at: '2026-09-20T10:00:00Z' });
    expect(buildCohort(data)).toMatchObject({ learners: 1, interactions: 3, rows: [{ first_inquiry_id: 'a', cohort_date: '2026-08-31' }] });
    expect(buildCohort({ ...data, from: '2026-09-01', to: '2026-09-30' }).learners).toBe(0);
  });
  test('GT-1005 returning, absent and unknown history are not new acquisition; complimentary present is', () => {
    const data = input();
    data.inquiries = ['returning', 'absent', 'unknown', 'free'].map(learner_id => ({ ...data.inquiries[0], learner_id, id: learner_id }));
    data.histories = ['returning', 'absent', 'free'].map(learner_id => ({ learner_id, complete: true }));
    data.attendance = [
      { learner_id: 'returning', occurrence_id: 'old', start_at: '2025-01-01T10:00:00Z', approved: true, attendance: 'present', attended_seconds: 3600 },
      ...['returning', 'absent', 'unknown', 'free'].map(learner_id => ({ learner_id, occurrence_id: learner_id, start_at: '2026-09-01T10:00:00Z', approved: true, attendance: learner_id === 'absent' ? 'absent' : 'present', attended_seconds: learner_id === 'absent' ? 0 : 3600 })),
    ];
    data.payments = [{ learner_id: 'absent', at: '2026-09-01T00:00:00Z' }];
    expect(buildCohort(data)).toMatchObject({ newly_taught: 1, returning: 1, unknown_history: 1, paid: 1, attended: 3 });
  });
  test('GT-1006/1508 source claims stay unknown; verified organic never becomes paid campaign credit', () => {
    const data = input(); data.inquiries.push({ ...data.inquiries[0], id: 'b', learner_id: 'organic', attribution: 'verified_organic' });
    const rows = buildCohort(data).rows;
    expect(rows.map(row => row.attribution)).toEqual(['unknown', 'verified_organic']);
  });
  test('GT-1007 late events select one winner with stable timestamp/id tie and as-of reproducibility', () => {
    const data = input(); data.inquiries[0].attribution = 'verified_campaign'; data.inquiries[0].campaign_id = 'second';
    data.inquiries.push({ ...data.inquiries[0], id: 'late', observed_at: '2026-08-01T12:00:00Z', recorded_at: '2026-11-01T00:00:00Z', campaign_id: 'first' });
    expect(buildCohort(data).rows[0].campaign_id).toBe('first');
    expect(buildCohort({ ...data, as_of: '2026-10-01T00:00:00Z' }).rows[0].campaign_id).toBe('second');
  });
  test('GT-1004 replay and unapproved attendance cannot inflate conversions', () => {
    const data = input(); const fact = { learner_id: 'one', occurrence_id: 'first', start_at: '2026-09-01T10:00:00Z', approved: true, attendance: 'present', attended_seconds: 3600 };
    data.attendance = [fact, fact, { ...fact, learner_id: 'other', approved: false }];
    expect(buildCohort(data).newly_taught).toBe(1);
  });
  test('observation windows and provisional maturity are explicit', () => {
    const data = input(); data.bookings = [{ learner_id: 'one', at: '2026-10-05T00:00:00Z' }];
    expect(buildCohort(data)).toMatchObject({ booked: 0, provisional: 0 });
    expect(buildCohort({ ...data, as_of: '2026-09-01T00:00:00Z' }).provisional).toBe(1);
  });
  test('GT-1008 zero denominator and missing spend remain different from confirmed zero', () => {
    expect(acquisitionCost(10000, 0)).toBeNull(); expect(acquisitionCost(null, 1)).toBeNull(); expect(acquisitionCost(0, 1)).toBe(0);
    expect(() => acquisitionCost(Infinity, 1)).toThrow();
  });
  test('tutor delivery is counted once per occurrence regardless of participant count', () => {
    expect(tutorSeconds([{ occurrence_id: 'a', seconds: 3600 }, { occurrence_id: 'a', seconds: 3600 }, { occurrence_id: 'b', seconds: 1800 }])).toBe(5400);
  });
  test('analytics transport rejects extra privileged fields, unsafe numbers and CSV formulas', () => {
    expect(analyticsCommands.record_campaign_spend.safeParse({ p_amount_minor: Infinity }).success).toBe(false);
    const row = { learner_id: '10000000-0000-4000-8000-000000000001', learner_name: '=HYPERLINK("bad")', first_inquiry_id: '10000000-0000-4000-8000-000000000002', first_inquiry_at: '2026-08-01T00:00:00Z', cohort_date: '2026-08-01', attribution: 'unknown', campaign_id: null, history_status: 'unknown', history_version: 1, interactions: 1, booked: false, paid: false, attended: false, newly_taught: false, first_attendance_at: null, first_occurrence_id: null, provisional: false, window_end: '2026-08-31T00:00:00Z' };
    expect(cohortRow.safeParse({ ...row, tutor_fee_minor: 10000 }).success).toBe(false);
    expect(cohortCsv([cohortRow.parse(row)])).toContain('"\'=HYPERLINK(""bad"")"');
  });
  test('GT-1509 conversion ratio recomputes from matching summed counts, not average percentages', () => {
    expect(cohortConversionRate([{ newly_taught: 2, learners: 2 }, { newly_taught: 3, learners: 8 }])).toBe(5 / 10);
    expect(cohortConversionRate([{ newly_taught: 0, learners: 0 }])).toBeNull();
  });
});
