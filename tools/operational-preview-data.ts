import { createHash } from 'node:crypto';
import type { WorkflowSnapshot, WorkflowTable } from '../src/modules/workflow-import/model';

export const operationalPreviewMarker = 'git-tutor-operational-preview-v1' as const;
export type SourceRow = WorkflowSnapshot['tables']['sessions']['rows'][number];
export function normalizedSourceName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en') : '';
}
export function sourceText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
export function stablePreviewId(sourceHash: string, label: string): string {
  const hex = createHash('sha256').update(`${operationalPreviewMarker}:${sourceHash}:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function previewCairoTime(value: string) {
  const date = new Date(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return { input: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`, label: new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short' }).format(date) };
}
/** Full normalized string equality only. First names, prefixes and duplicate full names stay unresolved. */
export function exactProfileRow(value: unknown, rows: SourceRow[]): number | null {
  const wanted = normalizedSourceName(value);
  if (!wanted) return null;
  const matches = rows.filter(row => normalizedSourceName(row.values.col_a) === wanted);
  return matches.length === 1 ? matches[0].source_row : null;
}
export function mapSourceEntities(snapshot: WorkflowSnapshot) {
  const students = snapshot.tables.students.rows.map(row => ({ sourceRow: row.source_row, label: `student:${row.source_row}`, name: sourceText(row.values.col_a) }));
  const tutors = snapshot.tables.tutors.rows.map(row => ({ sourceRow: row.source_row, label: `tutor:${row.source_row}`, name: sourceText(row.values.col_a) }));
  if ([...students, ...tutors].some(item => !item.name || item.name.length > 120)) throw new Error('SOURCE_PROFILE_NAME_INVALID');
  const courses = snapshot.courses.map((name, index) => ({ name, id: stablePreviewId(snapshot.source_sha256, `course:${normalizedSourceName(name)}`), slug: `workbook-course-${index + 1}-${createHash('sha256').update(normalizedSourceName(name)).digest('hex').slice(0, 8)}` }));
  // Every unmatched named source row is a separate provisional identity. A repeated first name is not proof of identity.
  const provisional: { label: string; name: string; table: 'sessions' | 'packages'; sourceRow: number }[] = [];
  const links: { table: WorkflowTable; sourceRow: number; studentLabel: string | null; tutorLabel: string | null; subjectId: string | null; exactStudent: boolean; exactTutor: boolean }[] = [];
  for (const table of ['sessions', 'packages'] as const) for (const row of snapshot.tables[table].rows) {
    const name = row.values[table === 'sessions' ? 'col_e' : 'col_b'];
    const studentRow = exactProfileRow(name, snapshot.tables.students.rows);
    let studentLabel = studentRow === null ? null : `student:${studentRow}`;
    if (!studentLabel && sourceText(name)) {
      studentLabel = `provisional:${table}:${row.source_row}`;
      provisional.push({ label: studentLabel, name: sourceText(name).slice(0, 120), table, sourceRow: row.source_row });
    }
    const tutorRow = table === 'sessions' ? exactProfileRow(row.values.col_h, snapshot.tables.tutors.rows) : null;
    const course = table === 'sessions' ? courses.find(item => normalizedSourceName(item.name) === normalizedSourceName(row.values.col_f)) : null;
    links.push({ table, sourceRow: row.source_row, studentLabel, tutorLabel: tutorRow === null ? null : `tutor:${tutorRow}`, subjectId: course?.id ?? null, exactStudent: studentRow !== null, exactTutor: tutorRow !== null });
  }
  return { students, tutors, courses, provisional, links };
}
/** Only explicit, error-free tuition and agreed fee cells are eligible for a new preview contract. */
export function practiceSourceTerms(snapshot: WorkflowSnapshot, sourceRow = 79) {
  const row = snapshot.tables.sessions.rows.find(item => item.source_row === sourceRow);
  if (!row || row.issues.length || exactProfileRow(row.values.col_e, snapshot.tables.students.rows) === null || exactProfileRow(row.values.col_h, snapshot.tables.tutors.rows) === null) throw new Error('PRACTICE_SOURCE_REQUIRES_EXACT_PROFILES');
  const tuitionMinor = row.values.col_q;
  // Fee Due is a status-dependent balance and may be zero before delivery. Use the
  // stated per-session rate (or explicit override) for a newly approved practice agreement.
  const tutorFeeMinor = row.values.col_y ?? row.values.col_ac;
  const start = typeof row.values.derived_start_at === 'string' ? Date.parse(row.values.derived_start_at) : NaN;
  const end = typeof row.values.derived_end_at === 'string' ? Date.parse(row.values.derived_end_at) : NaN;
  const durationMinutes = (end - start) / 60000;
  if (typeof tuitionMinor !== 'number' || !Number.isSafeInteger(tuitionMinor) || tuitionMinor <= 0 || typeof tutorFeeMinor !== 'number' || !Number.isSafeInteger(tutorFeeMinor) || tutorFeeMinor < 0 || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) throw new Error('PRACTICE_SOURCE_TERMS_INVALID');
  return { sourceRow, tuitionMinor, tutorFeeMinor, durationMinutes, studentRow: exactProfileRow(row.values.col_e, snapshot.tables.students.rows)!, tutorRow: exactProfileRow(row.values.col_h, snapshot.tables.tutors.rows)!, courseName: sourceText(row.values.col_f) };
}

/** Generated practice evidence, never a representation of a historical workbook transfer. */
export function previewPdf(lines: string[]): Buffer {
  const escaped = ['GIT TUTOR - PREVIEW PRACTICE ONLY', ...lines, 'Generated fake evidence. No real transfer or attendance is asserted.'].map(line => line.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&'));
  const stream = `BT /F1 12 Tf 40 790 Td ${escaped.map((line, index) => `${index ? '0 -22 Td ' : ''}(${line}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
