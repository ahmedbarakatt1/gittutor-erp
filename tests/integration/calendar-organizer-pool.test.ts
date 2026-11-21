import { test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { bookingFixture } from '../helpers/booking';
import { adminDatabase, authClient, loadLocalSupabase } from '../helpers/supabase';
import { exerciseCalendarOrganizerPool } from '../helpers/calendar-organizer-pool';
import { exerciseOrganizerConsent } from '../helpers/calendar-organizer-consent';
import { exerciseVerifiedCalendarCapacity } from '../helpers/calendar-verified-capacity';

test('independent workers reserve persistent, nonoverlapping organizer slots through retries and release',async()=>{
  const f=await bookingFixture(), second=await bookingFixture(), worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
  try {
    expect((await f.students[0].rpc('list_calendar_connections')).error?.message).toBe('FORBIDDEN');
    await f.availability();
    const source=await f.occurrence();
    const session=(await f.admin.auth.getSession()).data.session!;
    const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());
    await exerciseCalendarOrganizerPool(f.database,worker,claims,String(source.occurrence_id),
      [f,second].map(tutor=>({id:tutor.tutorId,email:tutor.actor.email})));
  } finally { await worker.end(); await second.close(); await f.close(); }
},90000);

test('Google consent is scoped to a unique organizer identity and versioned reconnection',async()=>{
  const db=await adminDatabase(), admin=await authClient('admin_a');
  const worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
  try {
    const {data:request,error}=await admin.rpc('create_calendar_connection_request',{p_idempotency_key:randomUUID()});
    expect(error).toBeNull();
    const connection=await worker.connect();
    try {
      await connection.query('begin');
      const envelope={v:1,alg:'A256GCM',kid:'test',nonce:'A'.repeat(16),tag:'A'.repeat(22),ciphertext:'AA'};
      const grant=await connection.query('select app_private.record_calendar_organizer($1,$2,$3,$4,$5,$6,$7,$8) r',
        [request.request_id,request.connection_id,randomUUID(),`worker.${randomUUID()}@example.test`,'primary',envelope,'test',randomUUID()]);
      expect(grant.rows[0].r).toMatchObject({connection_id:request.connection_id,calendar_id:'primary',verification_allowed:false});
    } finally { await connection.query('rollback'); connection.release(); }
    const session=(await admin.auth.getSession()).data.session!;
    await exerciseOrganizerConsent(db,JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString()),worker);
  } finally { await worker.end(); await admin.auth.signOut({scope:'local'}); await db.end(); }
});

test('only verified accounts supply live capacity, including legacy schedules and delayed Google creates',async()=>{
  const db=await adminDatabase(), admin=await authClient('admin_a');
  try {
    const session=(await admin.auth.getSession()).data.session!;
    await exerciseVerifiedCalendarCapacity(db,JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString()));
  } finally { await admin.auth.signOut({scope:'local'}); await db.end(); }
},60000);
