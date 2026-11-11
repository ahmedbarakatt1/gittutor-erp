import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { catalogFixtureIds } from '../../tools/catalog-seed';

test('an outbox failure rolls back allocation, case resolution and funded booking; the same command retries once', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const occurrenceId = (await f.database.query('select occurrence_id from app_private.enrollments where id=$1', [f.enrollmentId])).rows[0].occurrence_id as string;
    await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Synthetic exact approved private-session fee', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const account = await f.receiving(), transfer = await f.transfer(account.id, 50000), receipt = await f.receipt(account.versionId, 50000);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const args = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 50000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() };
    const beforeBalance = (await f.database.query('select finance_private.finance_transfer_balance($1) balance', [transfer.id])).rows[0].balance;
    const beforeCase = (await f.database.query('select state,version,owner_id,current_evidence_version from app_private.review_cases where id=$1', [receipt.case_id])).rows[0];
    const beforeOccurrence = (await f.database.query('select state,version,current_fee_agreement_id from app_private.occurrences where id=$1', [occurrenceId])).rows[0];
    const beforePostings = (await f.database.query('select id from finance_private.ledger_lines where transfer_id=$1 order by id', [transfer.id])).rows;
    const session = (await f.reviewer.auth.getSession()).data.session;
    if (!session) throw new Error('REAL_AUTH_SESSION_REQUIRED');
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
    await f.database.query('begin');
    try {
      // The trigger is transaction-local and targets only this synthetic case. Rollback removes it.
      await f.database.query(`create function pg_temp.fail_payment_outbox() returns trigger language plpgsql as $$
        begin if exists(select 1 from app_private.domain_events e where e.id=new.event_id and e.event_type='transfer_allocated' and e.aggregate_id::text=tg_argv[0]) then
          if not exists(select 1 from finance_private.payment_allocations where review_case_id::text=tg_argv[0])
            or not exists(select 1 from app_private.review_cases where id::text=tg_argv[0] and state='resolved') then raise exception 'SYNTHETIC_WRONG_FAILURE_POINT';end if;
          raise exception 'SYNTHETIC_PAYMENT_OUTBOX_FAILURE';end if;return new;end $$`);
      await f.database.query(`create trigger synthetic_payment_outbox_failure before insert on app_private.outbox_jobs for each row execute function pg_temp.fail_payment_outbox('${String(receipt.case_id)}')`);
      await f.database.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      await f.database.query('set local role authenticated');
      await expect(f.database.query('select api.allocate_transfer($1,$2,$3,$4,$5::jsonb,$6,$7)', [args.p_case_id, args.p_transfer_id, args.p_evidence_version, args.p_payment_plan_id, JSON.stringify(args.p_allocations), args.p_expected_version, args.p_idempotency_key])).rejects.toThrow('SYNTHETIC_PAYMENT_OUTBOX_FAILURE');
    } finally { await f.database.query('rollback'); }
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) balance', [transfer.id])).rows[0].balance).toEqual(beforeBalance);
    expect((await f.database.query('select state,version,owner_id,current_evidence_version from app_private.review_cases where id=$1', [receipt.case_id])).rows[0]).toEqual(beforeCase);
    expect((await f.database.query('select state,version,current_fee_agreement_id from app_private.occurrences where id=$1', [occurrenceId])).rows[0]).toEqual(beforeOccurrence);
    expect((await f.database.query('select id from finance_private.ledger_lines where transfer_id=$1 order by id', [transfer.id])).rows).toEqual(beforePostings);
    expect((await f.database.query('select id from finance_private.payment_allocations where review_case_id=$1', [receipt.case_id])).rowCount).toBe(0);
    expect((await f.database.query("select id from app_private.command_results where command_name='allocate_transfer' and idempotency_key=$1", [args.p_idempotency_key])).rowCount).toBe(0);
    expect((await f.database.query("select id from app_private.domain_events where event_type='transfer_allocated' and aggregate_id=$1", [receipt.case_id])).rowCount).toBe(0);
    expect((await f.database.query('select id from app_private.booking_commitments where occurrence_id=$1', [occurrenceId])).rowCount).toBe(0);
    const committed = await f.rpc('allocate_transfer', args, f.reviewer);
    expect(await f.rpc('allocate_transfer', args, f.reviewer)).toEqual(committed);
    expect((await f.database.query('select state from app_private.review_cases where id=$1', [receipt.case_id])).rows[0].state).toBe('resolved');
    expect((await f.database.query('select state from app_private.occurrences where id=$1', [occurrenceId])).rows[0].state).toBe('confirmed');
    expect((await f.database.query('select id from finance_private.payment_allocations where review_case_id=$1', [receipt.case_id])).rowCount).toBe(1);
    expect((await f.database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.event_type='transfer_allocated' and e.aggregate_id=$1 and j.purpose='notifications.route'", [receipt.case_id])).rowCount).toBe(1);
    expect((await f.database.query("select id from app_private.audit_events where action='transfer_allocated' and aggregate_id=$1", [receipt.case_id])).rowCount).toBe(1);
  } finally { await f.close(); }
});
