import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { invokeCatalogCommandWithStatus } from '../../src/modules/catalog/commands';
import { fixtureId } from '../../tools/db-seed';
import { authClient, type anonymousClient } from '../helpers/supabase';

describe('T03 real catalog RPC transport contracts', () => {
  let admin: ReturnType<typeof anonymousClient>;
  let independentAdmin: ReturnType<typeof anonymousClient>;
  beforeAll(async () => {
    admin = await authClient('admin_a');
    independentAdmin = await authClient('admin_a');
  });
  afterAll(async () => {
    await Promise.all([admin, independentAdmin].filter(Boolean).map(client => client.auth.signOut({ scope: 'local' })));
  });
  const pricingArgs = () => ({ p_scope: 'private', p_customer_pricing: {}, p_compensation: {}, p_idempotency_key: randomUUID() });
  const policyArgs = () => ({ p_kind: 'booking', p_scope: 'private', p_content: {}, p_idempotency_key: randomUUID() });

  test('pricing creation returns 201 and its identical durable replay returns 200', async () => {
    const args = pricingArgs();
    const created = await invokeCatalogCommandWithStatus(admin, 'create_pricing_draft', args);
    expect(created.status).toBe(201);
    const replay = await invokeCatalogCommandWithStatus(independentAdmin, 'create_pricing_draft', args);
    expect(replay.status).toBe(200);
    expect(replay.data).toEqual(created.data);
  });

  test('policy creation returns 201 and its identical durable replay returns 200', async () => {
    const args = policyArgs();
    const created = await invokeCatalogCommandWithStatus(admin, 'create_policy_draft', args);
    expect(created.status).toBe(201);
    const replay = await invokeCatalogCommandWithStatus(independentAdmin, 'create_policy_draft', args);
    expect(replay.status).toBe(200);
    expect(replay.data).toEqual(created.data);
  });

  test('offer creation returns 201 and its identical durable replay returns 200', async () => {
    const price = await invokeCatalogCommandWithStatus(admin, 'create_pricing_draft', pricingArgs());
    const policy = await invokeCatalogCommandWithStatus(admin, 'create_policy_draft', policyArgs());
    const args = { p_subject_id: fixtureId('subject_calculus'), p_format: 'private', p_duration_minutes: 60,
      p_capacity: 1, p_target_tier: null, p_pricing_version_id: price.data.resource_id,
      p_policy_version_id: policy.data.resource_id, p_idempotency_key: randomUUID() };
    const created = await invokeCatalogCommandWithStatus(admin, 'create_offer', args);
    expect(created.status).toBe(201);
    const replay = await invokeCatalogCommandWithStatus(independentAdmin, 'create_offer', args);
    expect(replay.status).toBe(200);
    expect(replay.data).toEqual(created.data);
  });

  test('a committed pricing update satisfies its strict response DTO and replays once', async () => {
    const created = await invokeCatalogCommandWithStatus(admin, 'create_pricing_draft', pricingArgs());
    const args = { p_pricing_version_id: created.data.resource_id, p_customer_pricing: { duration_minutes: 90 },
      p_compensation: {}, p_expected_version: 1, p_idempotency_key: randomUUID() };
    const updated = await invokeCatalogCommandWithStatus(admin, 'update_pricing_draft', args);
    expect(updated.status).toBe(200);
    expect(updated.data.version).toBe(2);
    expect(Object.keys(updated.data).sort()).toEqual(['command_id', 'resource_id', 'validation_errors', 'version']);
    const replay = await invokeCatalogCommandWithStatus(independentAdmin, 'update_pricing_draft', args);
    expect(replay).toEqual(updated);
    await expect(invokeCatalogCommandWithStatus(admin, 'update_pricing_draft', { ...args, p_customer_pricing: {} })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  test('a committed policy update satisfies its strict response DTO and replays once', async () => {
    const created = await invokeCatalogCommandWithStatus(admin, 'create_policy_draft', policyArgs());
    const args = { p_policy_version_id: created.data.resource_id, p_content: { deposit_basis_points: 0 },
      p_expected_version: 1, p_idempotency_key: randomUUID() };
    const updated = await invokeCatalogCommandWithStatus(admin, 'update_policy_draft', args);
    expect(updated.status).toBe(200);
    expect(updated.data.version).toBe(2);
    expect(Object.keys(updated.data).sort()).toEqual(['command_id', 'resource_id', 'validation_errors', 'version']);
    expect(await invokeCatalogCommandWithStatus(independentAdmin, 'update_policy_draft', args)).toEqual(updated);
  });

  test('independent concurrent draft editors expose one successful version and one conflict', async () => {
    const created = await invokeCatalogCommandWithStatus(admin, 'create_policy_draft', policyArgs());
    const responses = await Promise.allSettled([admin, independentAdmin].map((client, index) =>
      invokeCatalogCommandWithStatus(client, 'update_policy_draft', {
        p_policy_version_id: created.data.resource_id, p_content: { hold_minutes: index + 1 },
        p_expected_version: 1, p_idempotency_key: randomUUID(),
      })));
    expect(responses.filter(response => response.status === 'fulfilled')).toHaveLength(1);
    const failed = responses.find(response => response.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason.message).toBe('VERSION_CONFLICT');
    const accepted = responses.find(response => response.status === 'fulfilled');
    expect(accepted?.status === 'fulfilled' && accepted.value.data.version).toBe(2);
  });
});
