/** An occurrence is the additive unit. Participant joins cannot multiply teaching time. */
export function tutorSeconds(rows: { occurrence_id: string; seconds: number }[]): number {
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.seconds) || row.seconds < 0) throw new Error('VALIDATION_ERROR');
    if (occurrences.has(row.occurrence_id) && occurrences.get(row.occurrence_id) !== row.seconds) throw new Error('CONFLICTING_OCCURRENCE');
    occurrences.set(row.occurrence_id, row.seconds);
  }
  const result = [...occurrences.values()].reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(result)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return result;
}
