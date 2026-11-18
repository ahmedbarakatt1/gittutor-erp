import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { calendarFixture } from '../helpers/calendar';

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
