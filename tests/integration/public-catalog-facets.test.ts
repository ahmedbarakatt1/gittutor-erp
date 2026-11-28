import { expect, test } from 'vitest';
import { adminDatabase, authClient } from '../helpers/supabase';

type Subject = { subject_id: string; title: string; slug: string };
type Page = { items: { offer_id: string; subject: Subject }[]; next_cursor: string | null; subjects: Subject[] };

test('signed-in subject facets cover the eligible catalog independently of offer pagination and filters', async () => {
  const database = await adminDatabase();
  const member = await authClient('learner_a');
  try {
    const expected = (await database.query<Subject>(`
      select s.id subject_id,s.title,s.slug
      from app_private.subjects s
      where exists(select 1 from app_private.offers o
        where o.subject_id=s.id and app_private.booking_offer_sellable(o.id))
      order by s.title,s.id
    `)).rows;
    expect(expected.length).toBeGreaterThan(1);
    const first = await member.rpc('list_public_offers', { p_limit: 1 });
    expect(first.error).toBeNull();
    const page = first.data as Page;
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).not.toBeNull();
    expect(page.subjects).toEqual(expected);
    expect(Object.keys(page).sort()).toEqual(['items', 'next_cursor', 'subjects']);
    for (const subject of page.subjects) expect(Object.keys(subject).sort()).toEqual(['slug', 'subject_id', 'title']);
    const next = await member.rpc('list_public_offers', { p_limit: 1, p_cursor: page.next_cursor });
    expect(next.error).toBeNull();
    expect(next.data.subjects).toEqual(expected);
    expect(next.data.items[0].offer_id).not.toBe(page.items[0].offer_id);
    const filtered = await member.rpc('list_public_offers', { p_limit: 1, p_subject_id: page.items[0].subject.subject_id });
    expect(filtered.error).toBeNull();
    expect(filtered.data.subjects).toEqual(expected);
    expect(filtered.data.items.every((item: Page['items'][number]) => item.subject.subject_id === page.items[0].subject.subject_id)).toBe(true);
    expect(JSON.stringify(page.subjects)).not.toMatch(/fee_|compensation|margin|payout|internal_notes/);
    const grants = await database.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and has_function_privilege('anon',p.oid,'EXECUTE') order by p.proname");
    expect(grants.rows.map(row => row.proname)).toEqual([]);
  } finally { await member.auth.signOut({ scope: 'local' }); await database.end(); }
});
