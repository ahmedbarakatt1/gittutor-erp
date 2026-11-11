import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { parseManualStatement, statementLimits } from '../../src/server/providers/manual-statement';

const header = 'external_id,amount_minor,currency,observed_at';
function source(csv: string, overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from(csv);
  return { bytes, detected_mime: 'text/csv', checksum_sha256: createHash('sha256').update(bytes).digest('hex'), statement_period: { from: '2026-11-11', to: '2026-11-11' }, ...overrides };
}

test('manual CSV preserves exact minor units, quoted identifiers and source dates without declaring settlement', () => {
  const result = parseManualStatement(source(`\uFEFF${header}\r\n"REF,""quoted""",9007199254740991,EGP,2026-11-10T22:30:00Z\r\n`));
  expect(result).toEqual({ state: 'completed', reason_code: null, candidates: [{ external_id: 'REF,"quoted"', amount_minor: Number.MAX_SAFE_INTEGER, currency: 'EGP', observed_at: '2026-11-10T22:30:00.000Z' }] });
  expect(JSON.stringify(result)).not.toMatch(/settled|payer_account_id|allocation/);
  expect(parseManualStatement(source('currency,observed_at,external_id,amount_minor\nEGP,2026-11-11T09:00:00+02:00,REORDERED,55000')).state).toBe('completed');
});

test('Cairo business-date boundaries are checked separately from UTC statement instants', () => {
  expect(parseManualStatement(source(`${header}\nOUTSIDE,55000,EGP,2026-11-10T21:59:59Z`))).toMatchObject({ state: 'requires_manual_review', reason_code: 'OUTSIDE_STATEMENT_PERIOD', candidates: [] });
  expect(parseManualStatement(source(`${header}\nIN,55000,EGP,2026-11-11T21:59:59Z`)).state).toBe('completed');
  expect(parseManualStatement(source(`${header}\nOUT,55000,EGP,2026-11-11T22:00:00Z`)).state).toBe('requires_manual_review');
});

test('a malformed row prevents all candidate creation and reports no raw source content', () => {
  const good = `${header}\nGOOD,55000,EGP,2026-11-11T10:00:00Z\n`;
  for (const bad of ['PRIVATE,550.50,EGP,2026-11-11T10:00:00Z', 'PRIVATE,9007199254740992,EGP,2026-11-11T10:00:00Z', 'PRIVATE,55000,USD,2026-11-11T10:00:00Z', 'PRIVATE,55000,EGP,2026-02-30T10:00:00Z', 'PRIVATE,55000,EGP,2026-11-11T10:00:00', 'PRIVATE,1e4,EGP,2026-11-11T10:00:00Z']) {
    const result = parseManualStatement(source(good + bad));
    expect(result).toEqual({ state: 'requires_manual_review', reason_code: 'INVALID_ROW', candidates: [] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  }
  expect(parseManualStatement(source(good + 'GOOD,50000,EGP,2026-11-11T10:01:00Z')).reason_code).toBe('DUPLICATE_EXTERNAL_ID');
  expect(parseManualStatement(source(good + '"PRIVATE,55000,EGP,2026-11-11T10:00:00Z')).reason_code).toBe('MALFORMED_CSV');
  expect(parseManualStatement(source(`${header},settled\nPRIVATE,55000,EGP,2026-11-11T10:00:00Z,true`)).reason_code).toBe('HEADER_MISMATCH');
});

test('only actual clean file bytes can be parsed and unsupported or changed files remain reviewable', () => {
  const empty = source('');
  expect(parseManualStatement({ ...empty, bytes: null })).toEqual({ state: 'awaiting_file_bytes', reason_code: 'FILE_BYTES_UNAVAILABLE', candidates: [] });
  expect(parseManualStatement(source('%PDF-1.7 synthetic', { detected_mime: 'application/pdf' })).reason_code).toBe('PDF_REQUIRES_MANUAL_REVIEW');
  expect(parseManualStatement(source('binary', { detected_mime: 'application/octet-stream' })).reason_code).toBe('UNSUPPORTED_FILE_TYPE');
  expect(parseManualStatement(source(`${header}\nREF,55000,EGP,2026-11-11T10:00:00Z`, { checksum_sha256: '0'.repeat(64) })).reason_code).toBe('CHECKSUM_MISMATCH');
  const invalid = Buffer.from([0xc3, 0x28]);
  expect(parseManualStatement({ ...empty, bytes: invalid, checksum_sha256: createHash('sha256').update(invalid).digest('hex') }).reason_code).toBe('INVALID_UTF8');
});

test('file, row, column and cell limits bound parsing before any candidate result', () => {
  expect(parseManualStatement(source('x'.repeat(statementLimits.maxBytes + 1))).reason_code).toBe('INPUT_LIMIT_EXCEEDED');
  expect(parseManualStatement(source(`${header}\n${'x'.repeat(statementLimits.maxCellCharacters + 1)},1,EGP,2026-11-11T10:00:00Z`)).reason_code).toBe('INPUT_LIMIT_EXCEEDED');
  expect(parseManualStatement(source(Array(statementLimits.maxColumns + 1).fill('column').join(','))).reason_code).toBe('INPUT_LIMIT_EXCEEDED');
  const rows = Array.from({ length: statementLimits.maxRows + 1 }, (_, index) => `REF-${index},1,EGP,2026-11-11T10:00:00Z`).join('\n');
  expect(parseManualStatement(source(`${header}\n${rows}`)).reason_code).toBe('INPUT_LIMIT_EXCEEDED');
});
