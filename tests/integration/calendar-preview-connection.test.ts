import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { calendarFixture } from '../helpers/calendar';
import { exerciseCalendarBookingPilot } from '../helpers/calendar-booking-pilot';

test('connecting a Google test organizer preserves simulated rooms and queues no practice events', async () => {
  const fixture = await calendarFixture();
  try {
    const request = await fixture.rpc('create_calendar_connection_request', { p_idempotency_key: randomUUID() });
    const envelope = { v: 1, alg: 'A256GCM', kid: 'test', nonce: 'A'.repeat(16), tag: 'A'.repeat(22), ciphertext: 'AA' };
    await fixture.database.query('begin');
    try {
      const jobs = async () => (await fixture.database.query("select count(*) from app_private.outbox_jobs where purpose='calendar.sync'")).rows[0].count;
      const before = await jobs();
      await fixture.database.query('select app_private.record_calendar_connection($1,$2,$3,$4,$5,$6,$7)', [
        request.request_id, request.connection_id, randomUUID(), 'organizer@example.test', 'primary', envelope, 'test',
      ]);
      const { rows } = await fixture.database.query('select mode,state from app_private.provider_connections where id=any($1::uuid[]) order by mode', [[fixture.connectionId, request.connection_id]]);
      expect(rows).toEqual([{mode:'fake', state:'connected'}, {mode:'google', state:'preview_connected'}]);
      expect(await jobs()).toBe(before);
    } finally {
      await fixture.database.query('rollback');
    }
  } finally {
    await fixture.close();
  }
}, 60000);

test('a private pilot permits one learner and routes only its confirmed slot to the verified organizer', async () => {
  const f = await calendarFixture();
  try {
    const request = await f.rpc('create_calendar_connection_request', {p_idempotency_key:randomUUID()});
    const other = await f.rpc('create_calendar_connection_request', {p_idempotency_key:randomUUID()});
    await f.database.query('begin');
    try {
      const envelope = {v:1,alg:'A256GCM',kid:'test',nonce:'A'.repeat(16),tag:'A'.repeat(22),ciphertext:'AA'};
      await f.database.query('select app_private.record_calendar_connection($1,$2,$3,$4,$5,$6,$7)', [
        request.request_id,request.connection_id,randomUUID(),'organizer@example.test','primary',envelope,'test',
      ]);
      await f.database.query('update app_private.provider_connections set verified_at=now() where id=$1',[request.connection_id]);
      await f.database.query('select app_private.record_calendar_organizer($1,$2,$3,$4,$5,$6,$7,$8)', [
        other.request_id,other.connection_id,randomUUID(),'another-organizer@example.test','primary',envelope,'test',randomUUID(),
      ]);
      await f.database.query('update app_private.provider_connections set verified_at=now() where id=$1',[other.connection_id]);
      const learner = (await f.database.query('select learner_id,booker_account_id from app_private.enrollments where id=$1',[f.enrollmentId])).rows[0];
      const session = (await f.learner.auth.getSession()).data.session!;
      const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());
      await exerciseCalendarBookingPilot(f.database,f.occurrenceId,learner.learner_id,f.tutorId,learner.booker_account_id,
        request.connection_id as string,claims,other.connection_id as string);
    } finally { await f.database.query('rollback'); }
  } finally { await f.close(); }
}, 60000);
