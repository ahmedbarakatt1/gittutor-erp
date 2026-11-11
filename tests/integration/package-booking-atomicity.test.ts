import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { packageFixture } from '../helpers/packages';
import { raceBookingCalls } from '../helpers/booking';
import { loadLocalSupabase } from '../helpers/supabase';

let fixture: Awaited<ReturnType<typeof packageFixture>>;
let worker: Client;
beforeAll(async () => {
  fixture = await packageFixture();
  const config = loadLocalSupabase();
  if (!config.worker_database_url) throw new Error('LOCAL_WORKER_REQUIRED');
  worker = new Client({ connectionString: config.worker_database_url });
  await worker.connect();
}, 60000);
afterAll(async () => { await worker?.end(); await fixture?.close(); });

test('multi-learner hold expiry rolls back all releases on failure and retries exactly once', async () => {
  const first = await fixture.hold();
  const second = await fixture.reserve(first.occurrenceId, 1);
  const secondQuote = await fixture.rpc('get_quote', { p_quote_id: second.quote_id }, fixture.students[1]);
  await fixture.rpc('accept_quote', {
    p_quote_id: second.quote_id, p_quote_hash: secondQuote.quote_hash,
    p_expected_version: secondQuote.version, p_idempotency_key: randomUUID(),
  }, fixture.students[1]);
  const seats = [first.enrollmentId, second.enrollment_id as string];
  const packages: string[] = [];
  const policy = await fixture.grantPolicy(50000);
  for (let index = 0; index < seats.length; index++) {
    const client = fixture.students[index];
    const contract = await fixture.rpc('get_package_contract', {
      p_package_contract_version_id: fixture.policyId, p_learner_id: fixture.learners[index],
    }, client);
    const purchase = await fixture.rpc('purchase_package', {
      p_learner_id: fixture.learners[index], p_package_contract_version_id: fixture.policyId,
      p_accepted_terms_hash: contract.terms_hash, p_idempotency_key: randomUUID(),
    }, client);
    packages.push(purchase.resource_id as string);
    await fixture.grant(packages[index], policy, index ? 25000 : 50000, 1000);
    await fixture.rpc('reserve_package_credit', {
      p_package_id: packages[index], p_enrollment_id: seats[index], p_credit_quanta: 1000,
      p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID(),
    }, client);
  }
  // Move only this fixture's clock inputs. No deployed command accepts an artificial clock.
  await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=any($1::uuid[])", [seats]);
  const beforeSeats = (await fixture.database.query('select id,state,version from app_private.enrollments where id=any($1::uuid[]) order by id', [seats])).rows;
  const beforePackages = (await fixture.database.query('select id,version,app_private.package_balance(id) as balances from app_private.package_purchases where id=any($1::uuid[]) order by id', [packages])).rows;
  const lastLearnerIndex = fixture.learners[0] < fixture.learners[1] ? 1 : 0;
  const key = `atomic-expiry:${randomUUID()}`;
  await fixture.database.query('begin');
  try {
    // Transaction-local fault injection is automatically removed by rollback. It rejects the
    // second learner's release after the first release has already executed in the same command.
    await fixture.database.query(`create function pg_temp.fail_package_release() returns trigger language plpgsql as $$
      begin if new.kind='release' and new.enrollment_id::text=tg_argv[0] then
        raise exception 'SYNTHETIC_PACKAGE_RELEASE_FAILURE'; end if; return new; end $$`);
    await fixture.database.query(`create trigger synthetic_package_release_failure before insert on app_private.entitlement_movements
      for each row execute function pg_temp.fail_package_release('${seats[lastLearnerIndex]}')`);
    await expect(fixture.database.query('select app_private.process_occurrence_booking_due($1,$2)', [first.occurrenceId, key])).rejects.toThrow('SYNTHETIC_PACKAGE_RELEASE_FAILURE');
  } finally { await fixture.database.query('rollback'); }
  expect((await fixture.database.query('select id,state,version from app_private.enrollments where id=any($1::uuid[]) order by id', [seats])).rows).toEqual(beforeSeats);
  expect((await fixture.database.query('select id,version,app_private.package_balance(id) as balances from app_private.package_purchases where id=any($1::uuid[]) order by id', [packages])).rows).toEqual(beforePackages);
  expect((await fixture.database.query('select count(*)::int as n from app_private.booking_due_runs where occurrence_id=$1 and idempotency_key=$2', [first.occurrenceId, key])).rows[0].n).toBe(0);
  expect((await fixture.database.query("select count(*)::int as n from app_private.entitlement_movements where enrollment_id=any($1::uuid[]) and kind='release'", [seats])).rows[0].n).toBe(0);
  await worker.query('begin');
  try {
    const result = (await worker.query('select app_private.process_occurrence_booking_due($1,$2) as result', [first.occurrenceId, key])).rows[0].result;
    expect([...result.expired_enrollment_ids].sort()).toEqual([...seats].sort());
    expect((await worker.query('select app_private.process_occurrence_booking_due($1,$2) as result', [first.occurrenceId, key])).rows[0].result).toEqual(result);
    await worker.query('commit');
  } catch (error) { await worker.query('rollback'); throw error; }
  expect((await fixture.database.query('select state from app_private.enrollments where id=any($1::uuid[])', [seats])).rows).toEqual([{ state: 'expired' }, { state: 'expired' }]);
  expect((await fixture.database.query("select enrollment_id,count(*)::int as n from app_private.entitlement_movements where enrollment_id=any($1::uuid[]) and kind='release' group by enrollment_id", [seats])).rows.map(row => row.n)).toEqual([1, 1]);
  for (let index = 0; index < packages.length; index++) {
    expect((await fixture.database.query('select app_private.package_balance($1) as balances', [packages[index]])).rows[0].balances).toMatchObject({
      available_credit_quanta: 1000, reserved_credit_quanta: 0,
      available_value_minor: index ? 25000 : 50000, reserved_value_minor: 0,
    });
    expect((await fixture.database.query('select p.purchase_state,c.state,c.amount_minor from app_private.package_purchases p join finance_private.charges c on c.id=p.charge_id where p.id=$1', [packages[index]])).rows[0]).toEqual({ purchase_state: 'pending_funding', state: 'issued', amount_minor: '150000' });
  }
});

test('independent reserve and transfer commands cannot spend the same last credit', async () => {
  const source = await fixture.purchase(), target = await fixture.purchase(), policy = await fixture.grantPolicy(50000);
  await fixture.grant(source.resource_id as string, policy, 50000, 1000);
  const hold = await fixture.hold();
  const calls = [
    { client: fixture.learner, name: 'reserve_package_credit', args: {
      p_package_id: source.resource_id, p_enrollment_id: hold.enrollmentId, p_credit_quanta: 1000,
      p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID(),
    } },
    { client: fixture.learner, name: 'transfer_package_credit', args: {
      p_package_id: source.resource_id, p_target_package_id: target.resource_id, p_credit_quanta: 1000,
      p_conversion_proposal_id: null, p_reason: 'Synthetic cross-command contention',
      p_expected_target_version: 1, p_expected_version: 2, p_idempotency_key: randomUUID(),
    } },
  ];
  const results = await raceBookingCalls(calls);
  expect(results.filter(result => !result.error)).toHaveLength(1);
  // Retry only a changed financial graph, keeping the original request and key.
  // Once the winning transaction is visible, the stale purchase version must fail.
  for (let index = 0; index < results.length; index++) {
    if (results[index].error === 'RETRYABLE_CONFLICT') results[index] = (await raceBookingCalls([calls[index]]))[0];
  }
  expect(results.filter(result => !result.error)).toHaveLength(1);
  expect(results.find(result => result.error)?.error).toBe('VERSION_CONFLICT');
  const sourceBalance = (await fixture.database.query('select app_private.package_balance($1) as balances', [source.resource_id])).rows[0].balances;
  const targetBalance = (await fixture.database.query('select app_private.package_balance($1) as balances', [target.resource_id])).rows[0].balances;
  expect(sourceBalance.available_credit_quanta).toBe(0);
  expect(sourceBalance.reserved_credit_quanta + targetBalance.available_credit_quanta).toBe(1000);
  expect(sourceBalance.reserved_value_minor + targetBalance.available_value_minor).toBe(50000);
});

test('opposite concurrent transfers retain one acyclic lineage', async () => {
  const packages = [await fixture.purchase(), await fixture.purchase()], policy = await fixture.grantPolicy();
  for (const purchase of packages) await fixture.grant(purchase.resource_id as string, policy, 0, 1000);
  const results = await raceBookingCalls(packages.map((source, index) => ({ client: fixture.learner, name: 'transfer_package_credit', args: {
    p_package_id: source.resource_id, p_target_package_id: packages[1 - index].resource_id,
    p_credit_quanta: 1000, p_conversion_proposal_id: null, p_reason: 'Synthetic opposite transfer race',
    p_expected_target_version: 2, p_expected_version: 2, p_idempotency_key: randomUUID(),
  } })));
  expect(results.filter(result => !result.error)).toHaveLength(1);
  expect(results.find(result => result.error)?.error).toBe('VERSION_CONFLICT');
  expect((await fixture.database.query('select count(*)::int as n from app_private.package_transfers where source_purchase_id=any($1::uuid[]) and target_purchase_id=any($1::uuid[])', [packages.map(purchase => purchase.resource_id)])).rows[0].n).toBe(1);
});
