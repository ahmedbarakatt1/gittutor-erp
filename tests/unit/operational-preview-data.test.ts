import { describe, expect, it } from 'vitest';
import { exactProfileRow, mapSourceEntities, practiceSourceTerms, stablePreviewId } from '../../tools/operational-preview-data';
import type { WorkflowSnapshot } from '../../src/modules/workflow-import/model';

const row = (source_row: number, values: Record<string, string | number | null>) => ({ source_row, values, issues: [] as string[] });
function source(): WorkflowSnapshot {
  const empty = () => ({ columns: [], rows: [] });
  return { version: 1, source_name: 'synthetic.xlsx', source_sha256: 'a'.repeat(64), as_of: null, courses: ['Example Course'], tables: {
    students: { columns: [], rows: [row(5, { col_a: 'Example Student' })] }, tutors: { columns: [], rows: [row(5, { col_a: 'Example Tutor' })] },
    sessions: { columns: [], rows: [row(79, { col_e: 'Example Student', col_h: 'Example Tutor', col_f: 'Example Course', col_q: 80000, col_y: null, col_ac: 45000, col_ad: 0, derived_start_at: '2026-11-01T10:00:00Z', derived_end_at: '2026-11-01T11:30:00Z' })] }, packages: empty(), marketing: empty(), distributions: empty(), balances: empty(),
  } };
}
describe('authorized operational source mapping', () => {
  it('allows normalized exact names and refuses first-name and ambiguous matches', () => {
    const rows = source().tables.students.rows;
    expect(exactProfileRow('  EXAMPLE  Student ', rows)).toBe(5);
    expect(exactProfileRow('Example', rows)).toBeNull();
    expect(exactProfileRow('Example Student', [...rows, row(6, { col_a: 'Example Student' })])).toBeNull();
  });
  it('retains independent provisional identities for repeated unverified source names', () => {
    const snapshot = source();
    snapshot.tables.sessions.rows.push(row(80, { col_e: 'Example' }), row(81, { col_e: 'Example' }));
    const mapped = mapSourceEntities(snapshot);
    expect(mapped.provisional).toHaveLength(2);
    expect(mapped.provisional[0].label).not.toBe(mapped.provisional[1].label);
    expect(mapped.links[0]).toMatchObject({ studentLabel: 'student:5', tutorLabel: 'tutor:5', exactStudent: true });
    expect(mapped.links[1].exactStudent).toBe(false);
  });
  it('requires stated tuition and fee, preserves history, and rejects missing or fractional amounts', () => {
    const snapshot = source(), original = structuredClone(snapshot);
    expect(practiceSourceTerms(snapshot)).toMatchObject({ tuitionMinor: 80000, tutorFeeMinor: 45000, durationMinutes: 90 });
    expect(snapshot).toEqual(original);
    snapshot.tables.sessions.rows[0].values.col_ac = null;
    expect(() => practiceSourceTerms(snapshot)).toThrow('PRACTICE_SOURCE_TERMS_INVALID');
    snapshot.tables.sessions.rows[0].values.col_ac = 1.5;
    expect(() => practiceSourceTerms(snapshot)).toThrow('PRACTICE_SOURCE_TERMS_INVALID');
  });
  it('uses an explicit override before the rate and never uses the historical fee-due balance', () => {
    const snapshot = source();
    snapshot.tables.sessions.rows[0].values.col_y = 47000;
    snapshot.tables.sessions.rows[0].values.col_ad = 0;
    expect(practiceSourceTerms(snapshot).tutorFeeMinor).toBe(47000);
  });
  it('pins identifiers to source hash and entity label', () => {
    expect(stablePreviewId('a'.repeat(64), 'student:5')).toBe(stablePreviewId('a'.repeat(64), 'student:5'));
    expect(stablePreviewId('b'.repeat(64), 'student:5')).not.toBe(stablePreviewId('a'.repeat(64), 'student:5'));
  });
});
