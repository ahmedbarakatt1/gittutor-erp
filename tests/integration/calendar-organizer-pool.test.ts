import { test, expect } from 'vitest';
import { Pool } from 'pg';
import { bookingFixture } from '../helpers/booking';
import { adminDatabase, authClient, loadLocalSupabase } from '../helpers/supabase';
import { exerciseCalendarOrganizerPool } from '../helpers/calendar-organizer-pool';
import { exerciseOrganizerConsent } from '../helpers/calendar-organizer-consent';

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
  try {
    const session=(await admin.auth.getSession()).data.session!;
    await exerciseOrganizerConsent(db,JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString()));
  } finally { await admin.auth.signOut({scope:'local'}); await db.end(); }
});
