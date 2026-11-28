import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { expect, test } from 'vitest';
import { claimWorkerJobs } from '../../src/worker/claims';
import { assertTestDatabase, testDatabaseUrl } from '../helpers/environment';

test('manual workers leave WhatsApp deliveries and retries untouched while other jobs run', async () => {
  const db = new Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await assertTestDatabase(db);
    await db.query('begin');
    const whatsapp = 'support.whatsapp_send', other = 'manual-test.' + randomUUID();
    const ids: string[] = [];
    for (const purpose of [whatsapp, whatsapp, whatsapp, whatsapp, other]) {
      const event = randomUUID();
      const row = await db.query('select app_private.enqueue_event($1,$2,$1,$3,$4) id', [event, 'manual_test', {}, purpose]);
      ids.push(row.rows[0].id);
    }
    // Make all fixtures first in the queue. The transaction rolls back any unrelated claims.
    await db.query("update app_private.outbox_jobs set available_at='2000-01-01' where id=any($1::uuid[])", [ids]);
    await db.query("update app_private.outbox_jobs set state='leased',attempt_count=1,lease_expires_at=now()-interval '1 minute',lease_token=gen_random_uuid() where id=$1", [ids[1]]);
    await db.query('update app_private.outbox_jobs set attempt_count=max_attempts where id=$1', [ids[2]]);
    await db.query("update app_private.outbox_jobs set state='reconciliation',attempt_count=1,last_error_code='PROVIDER_OUTCOME_UNKNOWN' where id=$1", [ids[3]]);
    const snapshot = async () => (await db.query('select * from app_private.outbox_jobs where id=any($1::uuid[]) order by id', [ids.slice(0, 4)])).rows;
    const before = await snapshot();
    await db.query('set local role git_tutor_worker');
    expect(await claimWorkerJobs(db, whatsapp, 'manual')).toEqual([]);
    const claimed = await claimWorkerJobs(db, null, 'manual');
    expect(claimed.some(job => job.id === ids[4])).toBe(true);
    expect(claimed.every(job => job.purpose !== whatsapp)).toBe(true);
    await db.query('reset role');
    expect(await snapshot()).toEqual(before);
    expect((await db.query('select id from app_private.job_attempts where job_id=any($1::uuid[])', [ids.slice(0, 4)])).rows).toEqual([]);
    expect((await db.query("select has_function_privilege('authenticated','app_private.claim_jobs(text,integer,integer,text)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    await db.query('set local role git_tutor_worker');
    const first = await claimWorkerJobs(db, whatsapp, 'cloud');
    const second = await claimWorkerJobs(db, whatsapp, 'cloud');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect([first[0].id, second[0].id].sort()).toEqual(ids.slice(0, 2).sort());
  } finally {
    await db.query('rollback');
    await db.end();
  }
});

test('a non-superuser migration preserves the worker owner, execution boundary and existing schema grant', async () => {
  const db = new Client({ connectionString: testDatabaseUrl() });
  const role = 'manual_wa_test_' + randomUUID().replaceAll('-', '');
  const sql = await readFile('supabase/migrations/20261119150400_manual_channel_queue_claims.sql', 'utf8');
  await db.connect();
  try {
    await assertTestDatabase(db);
    await db.query('begin');
    // Rehearse both migration paths within a transaction on the disposable native queue database.
    await db.query('alter function app_private.claim_jobs(text,integer,integer,text) rename to claim_jobs_before_rehearsal');
    await db.query('revoke create on schema app_private from git_tutor_worker_api');
    await db.query('create role ' + role + ' nologin nosuperuser');
    await db.query('grant git_tutor_worker_api to ' + role);
    await db.query('grant usage,create on schema app_private to ' + role + ' with grant option');
    await db.query('set local role ' + role);
    for (const preexisting of [false, true]) {
      await db.query('savepoint before_transfer');
      if (preexisting) await db.query('grant create on schema app_private to git_tutor_worker_api');
      await db.query(sql);
      const permission = await db.query(`select p.proowner::regrole::text as owner,
        has_schema_privilege('git_tutor_worker_api','app_private','CREATE') schema_create,
        has_function_privilege('git_tutor_worker',p.oid,'EXECUTE') worker_exec,
        has_function_privilege('authenticated',p.oid,'EXECUTE') browser_exec
        from pg_proc p where p.oid='app_private.claim_jobs(text,integer,integer,text)'::regprocedure`);
      expect(permission.rows[0]).toEqual({ owner: 'git_tutor_worker_api', schema_create: preexisting, worker_exec: true, browser_exec: false });
      await db.query('rollback to savepoint before_transfer');
    }
  } finally {
    await db.query('rollback');
    await db.end();
  }
});
