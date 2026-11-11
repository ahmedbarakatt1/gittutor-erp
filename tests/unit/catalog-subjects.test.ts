import { expect, test, vi } from 'vitest';
import { listPublicOffers } from '../../src/modules/catalog/queries';

const subject = { subject_id: 'a3104068-9ad2-4d79-91b7-dc7c986f3079', title: 'Computer Science', slug: 'computer-science' };
function client(subjects: unknown) {
  return { rpc: vi.fn(async () => ({ data: { items: [], next_cursor: null, subjects }, error: null })) };
}

test('a filtered empty offer page retains the public subject choices', async () => {
  const result = await listPublicOffers(client([subject]), { subject_id: subject.subject_id, limit: 1 });
  expect(result).toEqual({ items: [], next_cursor: null, subjects: [subject] });
});

test('public subject choices reject private fields and malformed identities', async () => {
  await expect(listPublicOffers(client([{ ...subject, internal_notes: 'private' }]))).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(listPublicOffers(client([{ ...subject, subject_id: 'invalid' }]))).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
