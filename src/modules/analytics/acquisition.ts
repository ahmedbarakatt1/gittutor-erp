import { cairoDate } from '../shared/primitives';

export type Attribution = 'verified_campaign' | 'verified_organic' | 'unknown';
export type AcquisitionInput = {
  from: string; to: string; as_of: string; observation_days: number;
  inquiries: { id: string; learner_id: string; observed_at: string; recorded_at: string; attribution: Attribution; campaign_id: string | null }[];
  attendance: { learner_id: string; occurrence_id: string; start_at: string; approved: boolean; attendance: string; attended_seconds: number }[];
  histories: { learner_id: string; complete: boolean }[];
  bookings: { learner_id: string; at: string }[]; payments: { learner_id: string; at: string }[];
};

/** Lifetime first touch, then cohort date; observations use one fixed elapsed-time window. */
export function buildCohort(input: AcquisitionInput) {
  const asOf = Date.parse(input.as_of), first = new Map<string, AcquisitionInput['inquiries'][number]>();
  if (!Number.isFinite(asOf) || !Number.isInteger(input.observation_days) || input.observation_days < 1 || input.observation_days > 365) throw new Error('VALIDATION_ERROR');
  const visible = input.inquiries.filter(row => Date.parse(row.recorded_at) <= asOf && Date.parse(row.observed_at) <= asOf)
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at) || a.id.localeCompare(b.id));
  for (const row of visible) if (!first.has(row.learner_id)) first.set(row.learner_id, row);
  const rows = [...first.values()].filter(row => cairoDate(row.observed_at) >= input.from && cairoDate(row.observed_at) <= input.to).map(row => {
    const start = Date.parse(row.observed_at), end = start + input.observation_days * 86400000;
    const within = (at: string) => Date.parse(at) >= start && Date.parse(at) < end && Date.parse(at) <= asOf;
    const attendance = input.attendance.filter(fact => fact.learner_id === row.learner_id && fact.approved && fact.attendance === 'present' && fact.attended_seconds > 0 && Date.parse(fact.start_at) <= asOf)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.occurrence_id.localeCompare(b.occurrence_id));
    const returning = !!attendance[0] && Date.parse(attendance[0].start_at) < start;
    const historyComplete = input.histories.some(history => history.learner_id === row.learner_id && history.complete);
    return {
      learner_id: row.learner_id, first_inquiry_id: row.id, first_inquiry_at: row.observed_at, cohort_date: cairoDate(row.observed_at),
      attribution: row.attribution, campaign_id: row.attribution === 'verified_campaign' ? row.campaign_id : null,
      interactions: visible.filter(inquiry => inquiry.learner_id === row.learner_id && within(inquiry.observed_at)).length,
      booked: input.bookings.some(event => event.learner_id === row.learner_id && within(event.at)),
      paid: input.payments.some(event => event.learner_id === row.learner_id && within(event.at)),
      attended: attendance.some(event => within(event.start_at)), returning, unknown_history: !returning && !historyComplete,
      newly_taught: historyComplete && !returning && !!attendance[0] && within(attendance[0].start_at), provisional: end > asOf,
    };
  }).sort((a, b) => a.learner_id.localeCompare(b.learner_id));
  const count = (key: 'booked' | 'paid' | 'attended' | 'returning' | 'unknown_history' | 'newly_taught' | 'provisional') => rows.filter(row => row[key]).length;
  return { rows, learners: rows.length, interactions: rows.reduce((sum, row) => sum + row.interactions, 0), booked: count('booked'), paid: count('paid'), attended: count('attended'), returning: count('returning'), unknown_history: count('unknown_history'), newly_taught: count('newly_taught'), provisional: count('provisional') };
}

export function acquisitionCost(spendMinor: number | null, newlyTaught: number): number | null {
  if (!Number.isSafeInteger(newlyTaught) || newlyTaught < 0 || (spendMinor !== null && (!Number.isSafeInteger(spendMinor) || spendMinor < 0))) throw new Error('VALIDATION_ERROR');
  return spendMinor === null || newlyTaught === 0 ? null : Math.round(spendMinor / newlyTaught);
}

/** Aggregate matching counts, never average subgroup percentages. */
export function cohortConversionRate(groups: { newly_taught: number; learners: number }[]): number | null {
  let numerator = 0, denominator = 0;
  for (const group of groups) {
    if (!Number.isSafeInteger(group.newly_taught) || !Number.isSafeInteger(group.learners) || group.newly_taught < 0 || group.learners < group.newly_taught) throw new Error('VALIDATION_ERROR');
    numerator += group.newly_taught; denominator += group.learners;
  }
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return denominator === 0 ? null : numerator / denominator;
}
