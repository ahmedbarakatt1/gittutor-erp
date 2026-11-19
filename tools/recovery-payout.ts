import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { completionFixture } from '../tests/helpers/completion';
import { approvePayrollEarning, payrollTools } from '../tests/helpers/payroll';
import { previewPdf } from './operational-preview-data';

// A separate synthetic bank observation provides the cash reference and amount.
// Its scanned bytes are restored alongside the database and checked before replay.
const earnedMinor = 25000, payoutMinor = 15000;
type BankObservation = { receiving_account: string; reference: string; settled_at: string; amount_minor: number; currency: string };

export function recoveryBankStatement(observation: BankObservation) {
  return previewPdf(['Synthetic bank statement - settled outgoing payment',
    `Bank reference: ${observation.reference}`, `Receiving account: ${observation.receiving_account}`,
    `Settled UTC: ${observation.settled_at}`, `Amount: ${observation.amount_minor} minor units ${observation.currency}`]);
}

export async function prepareRecoveryPayout() {
  const fixture = await completionFixture();
  try {
    const payroll = await payrollTools(fixture);
    try {
      const earning = await approvePayrollEarning(fixture);
      const destination = await payroll.destination();
      const authorization = await fixture.rpc('authorize_payout', {
        p_tutor_id: fixture.tutorId, p_destination_version_id: destination.versionId,
        p_allocations: [{ earning_id: earning, amount_minor: payoutMinor }], p_idempotency_key: randomUUID(),
      });
      const attempt = authorization.payout_attempt_id as string;
      const uncertain = await payroll.evidence('reconcile_payout', attempt);
      const unknown = await fixture.rpc('reconcile_payout', {
        p_payout_attempt_id: attempt, p_outcome: 'unknown', p_receiving_account_id: null,
        p_external_reference: `manual-instruction-${randomUUID()}`, p_evidence_file_id: uncertain,
        p_settled_at: null, p_expected_version: authorization.version, p_idempotency_key: randomUUID(),
      });
      assert.equal(unknown.state, 'unknown');
      const observation = { receiving_account: fixture.receivingAccount.id as string, reference: `synthetic-bank-${randomUUID()}`,
        settled_at: new Date().toISOString(), amount_minor: payoutMinor, currency: 'EGP' };
      const bankPdf = recoveryBankStatement(observation);
      const proof = await payroll.evidence('reconcile_payout', attempt, bankPdf, 'synthetic-bank-settlement.pdf');
      const sha256 = createHash('sha256').update(bankPdf).digest('hex');
      assert.notEqual(proof, uncertain);
      const evidence = await fixture.database.query(
        'select object_key, checksum_sha256, app_private.file_is_clean(id) as clean from app_private.files where id=$1', [proof]);
      assert.equal(evidence.rows[0].checksum_sha256, sha256);
      assert.equal(evidence.rows[0].clean, true);
      return {
        attempt, tutor: fixture.tutorId, earning, evidenceId: proof, evidenceSha256: sha256,
        objectKey: evidence.rows[0].object_key as string, observation,
        parameters: [attempt, 'settled', observation.receiving_account, observation.reference, proof,
          observation.settled_at, unknown.version as number, randomUUID()],
      };
    } finally { await payroll.close(); }
  } finally { await fixture.close(); }
}

type Payout = Awaited<ReturnType<typeof prepareRecoveryPayout>>;

export async function settleRecoveryPayout(db: Client, payout: Payout, verifiedClaims: object) {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(verifiedClaims)]);
    await db.query('set local role authenticated');
    const result = await db.query('select api.reconcile_payout($1,$2,$3,$4,$5,$6,$7,$8) as command', payout.parameters);
    await db.query('commit');
    assert.equal(result.rows[0].command.state, 'settled');
    return result.rows[0].command;
  } catch (error) { await db.query('rollback'); throw error; }
}

export async function checkRecoveryPayout(db: Client, payout: Payout, state: 'unknown' | 'settled') {
  const row = (await db.query(`
    select p.state, p.version, b->'earned_minor' as earned_minor, b->'settled_minor' as settled_minor,
      b->'owed_minor' as owed_minor, b->'reserved_minor' as reserved_minor, b->'available_minor' as available_minor,
      (select count(*)::int from finance_private.payout_attempts where retry_of_attempt_id=p.id) as replacement_attempts,
      (select count(*)::int from finance_private.payout_outcomes where payout_attempt_id=p.id and outcome='unknown') as unknown_outcomes,
      (select count(*)::int from finance_private.payout_outcomes where payout_attempt_id=p.id and outcome='settled'
         and external_reference=$2 and evidence_file_id=$3 and receiving_account_id=$4 and ledger_transaction_id is not null) as evidenced_settlements,
      (select count(*)::int from finance_private.ledger_transactions where source_id=p.id and source_type='payout_settled') as payout_journals,
      (select count(*)::int from finance_private.ledger_transactions j join finance_private.ledger_lines l on l.transaction_id=j.id
         where j.source_id=p.id and l.account_code='channel_cash') as cash_postings,
      (select coalesce(sum(l.signed_minor),0)::int from finance_private.ledger_transactions j join finance_private.ledger_lines l on l.transaction_id=j.id
         where j.source_id=p.id and l.account_code='channel_cash' and l.receiving_account_id=$4) as cash_delta_minor,
      (select coalesce(sum(l.signed_minor),0)::int from finance_private.ledger_transactions j join finance_private.ledger_lines l on l.transaction_id=j.id
         where j.source_id=p.id and l.account_code='tutor_payable') as payable_debit_minor,
      (select count(*)::int from app_private.enrollments e join finance_private.tutor_earnings t on t.occurrence_id=e.occurrence_id
         where t.id=$5 and e.state='confirmed') as confirmed_seats
    from finance_private.payout_attempts p cross join lateral finance_private.payroll_statement(p.tutor_id) b
    where p.id=$1 and p.tutor_id=$6`, [payout.attempt, payout.observation.reference, payout.evidenceId,
      payout.observation.receiving_account, payout.earning, payout.tutor])).rows[0];
  const settled = state === 'settled', remaining = earnedMinor - payoutMinor;
  assert.deepEqual(row, {
    state, version: settled ? 3 : 2, earned_minor: earnedMinor, settled_minor: settled ? payoutMinor : 0,
    owed_minor: settled ? remaining : earnedMinor, reserved_minor: settled ? 0 : payoutMinor, available_minor: remaining,
    replacement_attempts: 0, unknown_outcomes: 1, evidenced_settlements: settled ? 1 : 0,
    payout_journals: settled ? 1 : 0, cash_postings: settled ? 1 : 0,
    cash_delta_minor: settled ? -payoutMinor : 0, payable_debit_minor: settled ? payoutMinor : 0, confirmed_seats: 1,
  });
  return row;
}
