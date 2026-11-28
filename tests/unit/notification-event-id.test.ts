import { expect, test } from 'vitest';
import { notificationSchema } from '../../src/modules/notifications/events';

test('support notifications accept historical PostgreSQL event IDs and require canonical delivery UUIDs', () => {
  const notification = {
    delivery_id: 'f3f8119a-dd9f-47c0-ae22-37ebf9fd131c',
    event_id: '2ef312dc-18f0-ca28-4532-41a9f848d2a7',
    state: 'delivered', created_at: '2026-11-23T12:00:00Z',
    content: { kind: 'support', locale: 'en', audience: 'customer', action_path: '/learn/support', starts_at: null },
  };
  expect(notificationSchema.parse(notification)).toEqual(notification);
  expect(notificationSchema.safeParse({ ...notification, event_id: 'junk' }).success).toBe(false);
  expect(notificationSchema.safeParse({ ...notification, delivery_id: notification.event_id }).success).toBe(false);
});
