import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { PublicShell, CatalogUnavailable } from '@/components/catalog/public-shell';
import { catalogCopy as copy } from '@/locales/catalog';
import { publicSupabase } from '@/server/supabase';
import { listPublicOffers, type PublicOffer } from '@/modules/catalog/queries';
import styles from '@/components/catalog/catalog.module.css';

export const metadata: Metadata = { title: 'Subjects | Git Tutor', description: 'Explore published tutoring offers for your subject.' };
export default async function SubjectsPage() {
  await connection();
  const subjects = new Map<string, { subject: PublicOffer['subject']; count: number }>();
  let unavailable = false;
  try {
    const client = publicSupabase();
    let cursor: string | null = null;
    do {
      const page = await listPublicOffers(client, { cursor, limit: 100 });
      for (const offer of page.items) { const entry = subjects.get(offer.subject.subject_id); subjects.set(offer.subject.subject_id, { subject: offer.subject, count: (entry?.count || 0) + 1 }); }
      cursor = page.next_cursor;
    } while (cursor);
  } catch { unavailable = true; }
  return <PublicShell active="subjects"><div className={styles.intro}><h1>{copy.subjectsTitle}</h1><p>{copy.subjectsDescription}</p></div>
    {unavailable ? <CatalogUnavailable retry="/subjects" /> : subjects.size ? <ul className={styles.subjectList}>{Array.from(subjects.values()).sort((a, b) => a.subject.title.localeCompare(b.subject.title)).map(({ subject, count }) => <li className={styles.subject} key={subject.subject_id}><div><h2>{subject.title}</h2><p>{copy.offerCount(count)}</p></div><Link className={styles.textLink} href={`/offers?subject_id=${subject.subject_id}`}>{copy.offers}</Link></li>)}</ul> : <section className={styles.empty}><h2>{copy.noSubjects}</h2><p>{copy.noSubjectsDescription}</p></section>}
  </PublicShell>;
}
