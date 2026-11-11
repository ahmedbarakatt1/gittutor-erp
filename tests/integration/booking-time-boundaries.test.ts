import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';

let fixture: Awaited<ReturnType<typeof bookingFixture>>;
beforeAll(async () => { fixture = await bookingFixture(); await fixture.availability(); });
afterAll(async () => { await fixture?.close(); });

test('direct scheduling RPC rejects instants outside the supported RFC3339 year range', async () => {
  const before = (await fixture.database.query('select count(*)::int as count from app_private.occurrences where tutor_id=$1', [fixture.tutorId])).rows[0].count;
  const result = await fixture.admin.rpc('create_occurrence', {
    p_offer_id: catalogFixtureIds.private_offer, p_tutor_id: fixture.tutorId,
    p_start_at: '10000-11-20T10:00:00Z', p_end_at: '10000-11-20T11:00:00Z',
    p_time_zone: 'Africa/Cairo', p_target_tier: null, p_idempotency_key: randomUUID(),
  });
  expect(result.error?.message).toBe('INVALID_TIME');
  expect((await fixture.database.query('select count(*)::int as count from app_private.occurrences where tutor_id=$1', [fixture.tutorId])).rows[0].count).toBe(before);
});
