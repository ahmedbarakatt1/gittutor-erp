import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { packageFixture } from '../helpers/packages';
import { loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { packageDueHandler } from '../../src/worker/package-due';

let fixture: Awaited<ReturnType<typeof packageFixture>>;
let worker: Pool;
beforeAll(async () => {
  fixture = await packageFixture();
  const config = loadLocalSupabase();
  if (!config.worker_database_url) throw new Error('LOCAL_WORKER_REQUIRED');
  worker = new Pool({ connectionString: config.worker_database_url });
}, 60_000);
afterAll(async () => { await worker?.end(); await fixture?.close(); });

async function claimOnly(jobId: string) {
  await fixture.database.query('begin');
  try {
    await fixture.database.query("select id from app_private.outbox_jobs where purpose='packages.process_due' and id<>$1 for update", [jobId]);
    const jobs = await claimJobs(worker, 'packages.process_due', 1, 60);
    expect(jobs.map(job => job.id)).toEqual([jobId]);
    return jobs[0];
  } finally { await fixture.database.query('rollback'); }
}

test('package expiry replays after a lost acknowledgement without duplicating movements or financial effects', async () => {
  const purchase = await fixture.purchase();
  const packageId = purchase.package_purchase_id as string;
  const policyId = await fixture.grantPolicy(50000);
  // Guarded historical fixture setup uses fresh immutable records, not altered issued/grant history.
  const expired = await fixture.historicalBonus({ purchaseId: packageId, grantPolicyId: policyId, valueMinor: 50000, expired: true });
  const future = await fixture.historicalBonus({ purchaseId: packageId, grantPolicyId: policyId, valueMinor: 30000 });
  const jobId = (await fixture.database.query('select app_private.enqueue_event($1,$2,$3,$4,$5) as id', [
    randomUUID(), 'package_due', packageId, { package_purchase_id: packageId }, 'packages.process_due',
  ])).rows[0].id as string;
  const first = await claimOnly(jobId);
  const handler = packageDueHandler(worker);
  await expect(handler.execute({ ...first, payload: { package_purchase_id: randomUUID() } })).rejects.toThrow('PACKAGE_JOB_INVALID');
  await handler.execute(first); // Domain commit succeeds; acknowledgement is deliberately lost.
  const snapshot = async () => (await fixture.database.query('select id,balances from app_private.package_lots where id=any($1::uuid[]) order by id', [[expired.lotId, future.lotId]])).rows;
  const committed = await snapshot();
  expect(committed.find(row => row.id === expired.lotId)?.balances).toMatchObject({ available_credit_quanta: 0, available_value_minor: 0, expired_credit_quanta: 1000, expired_value_minor: 50000 });
  expect(committed.find(row => row.id === future.lotId)?.balances).toMatchObject({ available_credit_quanta: 1000, available_value_minor: 30000, expired_credit_quanta: 0, expired_value_minor: 0 });

  await fixture.database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
  const reclaimed = await claimOnly(jobId);
  expect(reclaimed.attempt_count).toBe(2);
  expect(await executeLeasedJob(worker, reclaimed, handler)).toBe('completed');
  expect(await snapshot()).toEqual(committed);
  expect((await fixture.database.query("select count(*)::int as count from app_private.entitlement_movements where lot_id=$1 and kind='expire'", [expired.lotId])).rows[0].count).toBe(1);
  const runs = (await fixture.database.query('select result from app_private.package_due_runs where purchase_id=$1 and idempotency_key=$2', [packageId, `package-due:${jobId}`])).rows;
  expect(runs).toHaveLength(1);
  expect(runs[0].result.expired_lot_ids).toEqual([expired.lotId]);
  expect(Date.parse(runs[0].result.next_due_at)).toBe(future.expiresAt.getTime());
  const saved = (await fixture.database.query('select p.purchase_state,c.state,c.amount_minor from app_private.package_purchases p join finance_private.charges c on c.id=p.charge_id where p.id=$1', [packageId])).rows[0];
  expect(saved).toEqual({ purchase_state: 'pending_funding', state: 'issued', amount_minor: '150000' });
  const journal = (await fixture.database.query('select account_code,sum(signed_minor)::text as amount from finance_private.ledger_lines where package_purchase_id=$1 group by account_code', [packageId])).rows;
  expect(journal.some(row => /cash|revenue/.test(row.account_code))).toBe(false);
  expect(journal.reduce((sum, row) => sum + BigInt(row.amount), 0n)).toBe(0n);
});
