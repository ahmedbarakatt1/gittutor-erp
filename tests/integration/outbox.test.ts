import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { assertIsolatedTarget, assertTestDatabase, localDatabaseUrl, testDatabaseUrl } from '../helpers/environment';
import { seedSynthetic } from '../../tools/db-seed';

describe('T01 isolated environment and transactional outbox', () => {
  const clients: Client[] = [];
  let database: Client;
  const purpose = `test:${randomUUID()}`;
  async function connect(worker = false) {
    const client = new Client({ connectionString: worker ? localDatabaseUrl('gittutor_test', true) : testDatabaseUrl() });
    await client.connect();
    clients.push(client);
    return client;
  }
  async function enqueue(eventId = randomUUID()) {
    const result = await database.query('select app_private.enqueue_event($1, $2, $3, $4, $5) as id', [eventId, 'foundation_test', eventId, { synthetic: true }, purpose]);
    return { eventId, jobId: result.rows[0].id as string };
  }
  beforeAll(async () => { database = await connect(); await assertTestDatabase(database); });
  afterEach(async () => { if (database) await database.query('rollback'); });
  afterAll(async () => { await Promise.all(clients.map(client => client.end())); });

  test('production-designated and non-isolated targets reject fixture/reset authorization', () => {
    expect(() => assertIsolatedTarget({ connectionString: testDatabaseUrl(), environment: 'production' })).toThrow('ISOLATED_TARGET_REQUIRED');
    expect(() => assertIsolatedTarget({ connectionString: 'postgresql://user:pass@example.org:55432/gittutor_test', environment: 'test' })).toThrow('ISOLATED_TARGET_REQUIRED');
    expect(() => assertIsolatedTarget({ connectionString: 'postgresql://user:pass@127.0.0.1:55432/customer_records', environment: 'test' })).toThrow('ISOLATED_TARGET_REQUIRED');
  });

  test('the actual seeder rejects production designation before writing fixtures', async () => {
    const before = await database.query('select count(*)::int as count from app_private.synthetic_fixture_registry');
    const originalMarker = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    await expect(seedSynthetic(testDatabaseUrl(), 'production')).rejects.toThrow('ISOLATED_TARGET_REQUIRED');
    await database.query("update app_private.environment_metadata set environment='production' where singleton");
    try {
      await expect(assertTestDatabase(database)).rejects.toThrow('TEST_DATABASE_REQUIRED');
      await expect(seedSynthetic(testDatabaseUrl(), 'test')).rejects.toThrow('ISOLATED_TARGET_REQUIRED');
    } finally {
      await database.query('update app_private.environment_metadata set environment=$1,fixture_marker=$2 where singleton', [originalMarker.environment, originalMarker.fixture_marker]);
    }
    const after = await database.query('select count(*)::int as count from app_private.synthetic_fixture_registry');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('GT-1604 foundation subset: synthetic seed identities are deterministic and rerunning preserves records', async () => {
    await seedSynthetic(testDatabaseUrl(), 'test');
    const before = await database.query('select id,label,content from app_private.synthetic_fixture_registry order by label');
    await seedSynthetic(testDatabaseUrl(), 'test');
    const after = await database.query('select id,label,content from app_private.synthetic_fixture_registry order by label');
    expect(after.rows).toEqual(before.rows);
    expect(after.rows.length).toBeGreaterThan(5);
  });

  test('event and job roll back with the owning business transaction', async () => {
    const id = randomUUID();
    await database.query('begin');
    await enqueue(id);
    await database.query('rollback');
    const result = await database.query('select count(*)::int as count from app_private.domain_events where id=$1', [id]);
    expect(result.rows[0].count).toBe(0);
    const jobs = await database.query('select count(*)::int as count from app_private.outbox_jobs where event_id=$1', [id]);
    expect(jobs.rows[0].count).toBe(0);
  });

  test('stable event identity deduplicates work and rejects changed payload', async () => {
    const first = await enqueue();
    const replay = await enqueue(first.eventId);
    expect(replay.jobId).toBe(first.jobId);
    await expect(database.query('select app_private.enqueue_event($1,$2,$3,$4,$5)', [first.eventId, 'foundation_test', first.eventId, { synthetic: false }, purpose])).rejects.toThrow('EVENT_IDENTITY_CONFLICT');
  });

  test('two real worker connections racing one job receive exactly one lease', async () => {
    const workerA = await connect(true);
    const workerB = await connect(true);
    const pids = await Promise.all([workerA, workerB].map(client => client.query('select pg_backend_pid() as id')));
    expect(pids[0].rows[0].id).not.toBe(pids[1].rows[0].id);
    const exclusivePurpose = `${purpose}:race`;
    const id = randomUUID();
    await database.query('select app_private.enqueue_event($1,$2,$1,$3,$4)', [id, 'foundation_test', { synthetic: true }, exclusivePurpose]);
    const results = await Promise.all([workerA, workerB].map(client => client.query('select * from app_private.claim_jobs($1,1,30)', [exclusivePurpose])));
    expect(results.flatMap(result => result.rows)).toHaveLength(1);
    expect(results.flatMap(result => result.rows)[0].attempt_count).toBe(1);
  });

  test('expired lease recovers and the stale owner cannot complete it', async () => {
    const worker = await connect(true);
    const leasePurpose = `${purpose}:lease`;
    const id = randomUUID();
    await database.query('select app_private.enqueue_event($1,$2,$1,$3,$4)', [id, 'foundation_test', { synthetic: true }, leasePurpose]);
    const first = (await worker.query('select * from app_private.claim_jobs($1,1,30)', [leasePurpose])).rows[0];
    await database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
    const second = (await worker.query('select * from app_private.claim_jobs($1,1,30)', [leasePurpose])).rows[0];
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(second.attempt_count).toBe(2);
    await expect(worker.query('select app_private.complete_job($1,$2,$3)', [first.id, first.lease_token, 'fake:old'])).rejects.toThrow('LEASE_LOST');
    await worker.query('select app_private.complete_job($1,$2,$3)', [second.id, second.lease_token, 'fake:complete']);
    const result = await database.query('select state, provider_reference from app_private.outbox_jobs where id=$1', [first.id]);
    expect(result.rows[0]).toEqual({ state: 'completed', provider_reference: 'fake:complete' });
  });

  test('GT-1605 private boundary: worker and browser roles cannot read raw private tables', async () => {
    const worker = await connect(true);
    await expect(worker.query('select * from app_private.domain_events')).rejects.toThrow('permission denied');
    const browser = await connect();
    await browser.query('set role authenticated');
    await expect(browser.query('select * from app_private.outbox_jobs')).rejects.toThrow('permission denied');
    await expect(browser.query('select * from app_private.claim_jobs(null,1,30)')).rejects.toThrow('permission denied');
    await browser.query('reset role');
  });

  test('unknown outcomes remain in reconciliation and are never blindly retried', async () => {
    const worker = await connect(true);
    const unknownPurpose = `${purpose}:unknown`;
    const id = randomUUID();
    await database.query('select app_private.enqueue_event($1,$2,$1,$3,$4)', [id, 'foundation_test', { synthetic: true }, unknownPurpose]);
    const job = (await worker.query('select * from app_private.claim_jobs($1,1,30)', [unknownPurpose])).rows[0];
    await worker.query('select app_private.fail_job($1,$2,$3,true)', [job.id, job.lease_token, 'PROVIDER_TIMEOUT']);
    await database.query("update app_private.outbox_jobs set available_at=now()-interval '1 second' where id=$1", [job.id]);
    expect((await worker.query('select * from app_private.claim_jobs($1,1,30)', [unknownPurpose])).rows).toHaveLength(0);
    expect((await database.query('select state from app_private.outbox_jobs where id=$1', [job.id])).rows[0].state).toBe('reconciliation');
  });

  test('retry metadata delays transient failure and stops exhausted attempts', async () => {
    const worker = await connect(true);
    const retryPurpose = `${purpose}:retry`;
    const id = randomUUID();
    await database.query('select app_private.enqueue_event($1,$2,$1,$3,$4)', [id, 'foundation_test', { synthetic: true }, retryPurpose]);
    const job = (await worker.query('select * from app_private.claim_jobs($1,1,30)', [retryPurpose])).rows[0];
    await worker.query('select app_private.fail_job($1,$2,$3,false)', [job.id, job.lease_token, 'DEPENDENCY_UNAVAILABLE']);
    const retry = (await database.query('select state,last_error_code,available_at>now() as delayed from app_private.outbox_jobs where id=$1', [job.id])).rows[0];
    expect(retry).toEqual({ state: 'pending', last_error_code: 'DEPENDENCY_UNAVAILABLE', delayed: true });
    await database.query("update app_private.outbox_jobs set max_attempts=1,available_at=now()-interval '1 second' where id=$1", [job.id]);
    expect((await worker.query('select * from app_private.claim_jobs($1,1,30)', [retryPurpose])).rows).toHaveLength(0);
    expect((await database.query('select state from app_private.outbox_jobs where id=$1', [job.id])).rows[0].state).toBe('failed');
  });
});
