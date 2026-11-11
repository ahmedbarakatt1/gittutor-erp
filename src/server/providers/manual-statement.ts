import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cairoDate } from '../../modules/shared/primitives';

export const statementLimits = { maxBytes: 25 * 1024 * 1024, maxRows: 10_000, maxColumns: 16, maxCellCharacters: 4096 } as const;
const metadata = z.object({ detected_mime: z.string(), checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/), statement_period: z.object({ from: z.iso.date(), to: z.iso.date() }).strict().refine(value => value.from <= value.to) }).strict();
const instant = z.iso.datetime({ offset: true }).refine(value => !value.startsWith('0000-') && Number.isFinite(Date.parse(value)));
export type StatementCandidate = { external_id: string; amount_minor: number; currency: 'EGP'; observed_at: string };
export type StatementReason = 'FILE_BYTES_UNAVAILABLE' | 'PDF_REQUIRES_MANUAL_REVIEW' | 'UNSUPPORTED_FILE_TYPE' | 'INPUT_LIMIT_EXCEEDED' | 'INVALID_UTF8' | 'MALFORMED_CSV' | 'HEADER_MISMATCH' | 'INVALID_ROW' | 'OUTSIDE_STATEMENT_PERIOD' | 'DUPLICATE_EXTERNAL_ID' | 'CHECKSUM_MISMATCH';
export type StatementResult = { state: 'completed'; reason_code: null; candidates: StatementCandidate[] } | { state: 'requires_manual_review' | 'awaiting_file_bytes'; reason_code: StatementReason; candidates: [] };

/** Bounded RFC4180 quoting with LF accepted alongside CRLF. No delimiter/encoding guessing or partial imports. */
function csvRecords(text: string) {
  const records: string[][] = []; let row: string[] = [], cell = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  function field() {
    row.push(cell); cell = ''; state = 'start';
    if (row.length > statementLimits.maxColumns) throw new Error('INPUT_LIMIT_EXCEEDED');
  }
  function record() {
    field(); records.push(row); row = [];
    if (records.length > statementLimits.maxRows + 1) throw new Error('INPUT_LIMIT_EXCEEDED');
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; } else state = 'closed';
      } else cell += char;
    } else if (char === ',') field();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[++index] !== '\n') throw new Error('MALFORMED_CSV');
      record();
    } else if (state === 'closed') throw new Error('MALFORMED_CSV');
    else if (char === '"') {
      if (state !== 'start') throw new Error('MALFORMED_CSV');
      state = 'quoted';
    } else { cell += char; state = 'plain'; }
    if (cell.length > statementLimits.maxCellCharacters) throw new Error('INPUT_LIMIT_EXCEEDED');
  }
  if (state === 'quoted') throw new Error('MALFORMED_CSV');
  if (row.length || cell.length || state !== 'start') record();
  return records;
}

/** Manual adapter output is pending evidence only. Settlement, payer ownership and allocations require independent commands. */
export function parseManualStatement(source: { bytes: Uint8Array | null; detected_mime: string; checksum_sha256: string; statement_period: { from: string; to: string } }): StatementResult {
  const { bytes, ...rawMetadata } = source;
  const parsed = metadata.safeParse(rawMetadata);
  if (!parsed.success || (bytes !== null && !(bytes instanceof Uint8Array))) throw new Error('STATEMENT_INPUT_INVALID');
  const review = (reason_code: StatementReason): StatementResult => ({ state: 'requires_manual_review', reason_code, candidates: [] });
  if (bytes === null) return { state: 'awaiting_file_bytes', reason_code: 'FILE_BYTES_UNAVAILABLE', candidates: [] };
  if (bytes.byteLength > statementLimits.maxBytes) return review('INPUT_LIMIT_EXCEEDED');
  if (createHash('sha256').update(bytes).digest('hex') !== parsed.data.checksum_sha256) return review('CHECKSUM_MISMATCH');
  if (parsed.data.detected_mime === 'application/pdf') return review('PDF_REQUIRES_MANUAL_REVIEW');
  if (parsed.data.detected_mime !== 'text/csv') return review('UNSUPPORTED_FILE_TYPE');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return review('INVALID_UTF8'); }
  let rows: string[][];
  try { rows = csvRecords(text); }
  catch (error) { return review(error instanceof Error && error.message === 'INPUT_LIMIT_EXCEEDED' ? 'INPUT_LIMIT_EXCEEDED' : 'MALFORMED_CSV'); }
  const expected = ['external_id', 'amount_minor', 'currency', 'observed_at'], header = rows.shift();
  if (!header || header.length !== expected.length || new Set(header).size !== expected.length || header.some(name => !expected.includes(name))) return review('HEADER_MISMATCH');
  const candidates: StatementCandidate[] = [], seen = new Set<string>();
  for (const row of rows) {
    if (row.length !== header.length) return review('INVALID_ROW');
    const item = Object.fromEntries(header.map((name, index) => [name, row[index]]));
    if (!item.external_id || item.external_id.trim() !== item.external_id || item.external_id.length > 200 || /\p{C}/u.test(item.external_id)
      || !/^\d{1,16}$/.test(item.amount_minor) || BigInt(item.amount_minor) < 1n || BigInt(item.amount_minor) > BigInt(Number.MAX_SAFE_INTEGER)
      || item.currency !== 'EGP' || !instant.safeParse(item.observed_at).success) return review('INVALID_ROW');
    const businessDate = cairoDate(item.observed_at);
    if (businessDate < parsed.data.statement_period.from || businessDate > parsed.data.statement_period.to) return review('OUTSIDE_STATEMENT_PERIOD');
    if (seen.has(item.external_id)) return review('DUPLICATE_EXTERNAL_ID');
    seen.add(item.external_id);
    candidates.push({ external_id: item.external_id, amount_minor: Number(item.amount_minor), currency: 'EGP', observed_at: new Date(item.observed_at).toISOString() });
  }
  return { state: 'completed', reason_code: null, candidates };
}
