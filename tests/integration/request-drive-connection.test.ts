import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { Pool } from 'pg';
import { adminDatabase, authClient, loadLocalSupabase } from '../helpers/supabase';

test('Drive status is read-only for other admins and only a current verified owner can save or use the grant', async () => {
  const db = await adminDatabase();
  const admin = await authClient('admin_a');
  const worker = new Pool({ connectionString: loadLocalSupabase().worker_database_url });
  try {
    const session = (await admin.auth.getSession()).data.session!;
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
    expect((await worker.query('select app_private.read_request_drive_grant() as grant')).rows[0].grant).toBeNull();
    await expect(worker.query('select envelope from app_private.request_drive_connection')).rejects.toThrow('permission denied');
    await db.query('begin');
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    const access = await db.query(`select has_table_privilege('git_tutor_worker','app_private.request_drive_connection','SELECT') as raw,
      has_function_privilege('authenticated','app_private.read_request_drive_grant()','execute') as browser,
      has_function_privilege('anon','api.get_request_drive_status()','execute') as anon`);
    expect(access.rows[0]).toEqual({ raw: false, browser: false, anon: false });
    await db.query('set local role authenticated');
    const status = async () => (await db.query('select api.get_request_drive_status() as data')).rows[0].data;
    expect(await status()).toEqual({ can_connect: false, state: 'awaiting_consent' });
    await db.query('reset role');
    // The fixed address is transaction-local to this disposable test and cannot receive mail.
    await db.query('update auth.users set email=$2 where id=$1', [claims.sub, 'gittutor2@gmail.com']);
    await db.query('set local role authenticated');
    const initial = await status();
    expect(initial).toMatchObject({ can_connect: true, actor_id: claims.sub, session_id: claims.session_id });
    await db.query('reset role');
    const version = randomUUID(), next = randomUUID();
    const envelope = { v: 1, alg: 'A256GCM', kid: 'test', nonce: 'A'.repeat(16), tag: 'A'.repeat(22), ciphertext: 'fixture' };
    const args = [claims.sub, claims.session_id, initial.consent_version, version, 'gittutor2@gmail.com', 'synthetic-subject', envelope];
    await db.query('savepoint envelope_validation');
    await expect(db.query('select app_private.record_request_drive_grant($1,$2,$3,$4,$5,$6,$7)', [...args.slice(0, 6), { refresh_token: 'fixture' }])).rejects.toThrow('request_drive_envelope_valid');
    await db.query('rollback to envelope_validation');
    await db.query('select app_private.record_request_drive_grant($1,$2,$3,$4,$5,$6,$7)', args);
    const active = async () => (await db.query('select app_private.request_drive_connected() as connected')).rows[0].connected;
    expect(await active()).toBe(true);
    expect((await db.query('select app_private.update_request_drive_token($1,$2,null) as saved', [randomUUID(), next])).rows[0].saved).toBe(false);
    await db.query('savepoint saved_grant');
    await expect(db.query('select app_private.record_request_drive_grant($1,$2,$3,$4,$5,$6,$7)', args)).rejects.toThrow('STATE_CONFLICT');
    await db.query('rollback to saved_grant');
    await db.query("update app_private.account_roles set revoked_at=now() where account_id=$1 and role='admin' and revoked_at is null", [claims.sub]);
    expect(await active()).toBe(false);
    await expect(status()).rejects.toThrow('FORBIDDEN');
    await db.query('rollback to saved_grant');
    expect((await db.query('select app_private.update_request_drive_token($1,$2,null) as saved', [version, next])).rows[0].saved).toBe(true);
    const reconnect = await status();
    expect(reconnect).toMatchObject({ state: 'reconnect', can_connect: true });
    await db.query('select app_private.record_request_drive_grant($1,$2,$3,$4,$5,$6,$7)', [
      claims.sub, claims.session_id, reconnect.consent_version, randomUUID(), 'gittutor2@gmail.com', 'synthetic-subject', envelope,
    ]);
    expect(await active()).toBe(true);
    await db.query('update auth.users set email=$2 where id=$1', [claims.sub, 'former-owner@example.test']);
    expect(await active()).toBe(false);
    expect((await db.query('select app_private.read_request_drive_grant() as grant')).rows[0].grant).toBeNull();
    await expect(db.query('select app_private.record_request_drive_grant($1,$2,$3,$4,$5,$6,$7)', args)).rejects.toThrow('FORBIDDEN');
  } finally {
    await db.query('rollback');
    await admin.auth.signOut({ scope: 'local' });
    await db.end();
    await worker.end();
  }
});
