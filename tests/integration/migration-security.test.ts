import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from 'vitest';
import { migrate } from '../../tools/db-migrate';
import { verifyDatabaseBoundary } from '../../tools/db-verify';
import { assertIsolatedTarget, assertTestDatabase, testDatabaseUrl } from '../helpers/environment';

/** Only a newly created, randomly named disposable database is dropped by this test. */
test('GT-1605 clean migrations and reapply reproduce the private database boundary', async () => {
  const name = `gittutor_migration_${randomBytes(6).toString('hex')}`;
  const target = new URL(testDatabaseUrl());
  target.pathname = `/${name}`;
  const connectionString = target.toString();
  assertIsolatedTarget({ connectionString, environment: 'test' });
  const administrator = new Client({ connectionString: testDatabaseUrl() });
  await administrator.connect();
  await assertTestDatabase(administrator);
  let created = false;
  async function removeCreatedDatabase() {
    // Runtime validation prevents broad names or user-supplied identifiers reaching DROP DATABASE.
    if (created && /^gittutor_migration_[a-f0-9]{12}$/.test(name)) {
      await administrator.query(`drop database "${name}"`);
      created = false;
    }
  }
  async function snapshot() {
    await administrator.query(`create database "${name}"`);
    created = true;
    await expect(verifyDatabaseBoundary(connectionString)).rejects.toThrow('DATABASE_FOUNDATION_MISSING');
    await migrate(connectionString, 'test');
    await migrate(connectionString, 'test');
    const client = new Client({ connectionString });
    await client.connect();
    try {
      expect((await client.query("select to_regnamespace('supabase_migrations') as reserved")).rows[0].reserved).toBeNull();
      expect((await client.query('select count(*)::int as count from git_tutor_migrations.applied_migrations')).rows[0].count).toBeGreaterThan(0);
      const relations = (await client.query(`
        select n.nspname as schema,c.relname,c.relkind,c.relrowsecurity,
          has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_grant,
          has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated_grant
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('api','app_private','finance_private') and c.relkind in ('r','v','m')
        order by n.nspname,c.relname
      `)).rows;
      expect(relations.length).toBeGreaterThan(0);
      for (const relation of relations) {
        expect(relation.anon_grant).toBe(false);
        expect(relation.authenticated_grant).toBe(false);
        if (relation.relkind === 'r') expect(relation.relrowsecurity).toBe(true);
      }
      const sequences = (await client.query(`
        select n.nspname as schema,c.relname,
          has_sequence_privilege('anon',c.oid,'USAGE,SELECT,UPDATE') as anon_grant,
          has_sequence_privilege('authenticated',c.oid,'USAGE,SELECT,UPDATE') as authenticated_grant
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('api','app_private','finance_private') and c.relkind='S'
        order by n.nspname,c.relname
      `)).rows;
      for (const sequence of sequences) {
        expect(sequence.anon_grant).toBe(false);
        expect(sequence.authenticated_grant).toBe(false);
      }
      const functions = (await client.query(`
        select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef,p.proconfig,r.rolcanlogin,r.rolbypassrls,
          has_function_privilege('anon',p.oid,'EXECUTE') as anon_grant,
          has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_grant
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
        where n.nspname in ('api','app_private','finance_private') order by n.nspname,p.proname,arguments
      `)).rows;
      for (const fn of functions) {
        const publicRead = fn.schema === 'api' && ['list_public_offers', 'get_public_tutor'].includes(fn.proname);
        expect(fn.anon_grant).toBe(publicRead);
        if (fn.schema !== 'api') expect(fn.authenticated_grant).toBe(false);
        if (fn.prosecdef) {
          expect(fn.rolcanlogin).toBe(false);
          expect(fn.rolbypassrls).toBe(false);
          expect(fn.proconfig).toContain('search_path=""');
        }
      }
      return { relations, sequences, functions };
    } finally { await client.end(); }
  }
  try {
    const initial = await snapshot();
    await removeCreatedDatabase();
    const replay = await snapshot();
    expect(replay).toEqual(initial);
  } finally {
    await removeCreatedDatabase();
    await administrator.end();
  }
}, 30000);
