import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { PublicShell, CatalogUnavailable } from '@/components/catalog/public-shell';
import { catalogCopy as copy } from '@/locales/catalog';
import { publicSupabase } from '@/server/supabase';
import { listPublicOffers, type PublicOffer } from '@/modules/catalog/queries';
import styles from '@/components/catalog/catalog.module.css';
import { CourseHelp } from '@/components/public-contact';
import { publicContact } from '@/locales/contact';

export const metadata: Metadata = { title: 'Subjects | Git Tutor', description: 'Explore published tutoring offers for your subject.' };
export default async function SubjectsPage() {
  await connection();
  const subjects = new Map<string, PublicOffer['subject']>();
  let unavailable = false;
  try {
    const client = publicSupabase();
    let cursor: string | null = null;
    do {
      const page = await listPublicOffers(client, { cursor, limit: 100 });
      for (const offer of page.items) subjects.set(offer.subject.slug, offer.subject);
      cursor = page.next_cursor;
    } while (cursor);
  } catch { unavailable = true; }
  return <PublicShell active="subjects"><div className={`${styles.intro} ${styles.subjectIntro}`}><h1>{copy.subjectsTitle}</h1><p>{copy.subjectsDescription}</p></div>
    {unavailable && <CatalogUnavailable retry="/subjects" />}
    <ul className={styles.subjectList}>{Object.entries(copy.subjectDetails).sort(([, a], [, b]) => a.order - b.order).map(([slug, detail]) => {
      const subject = unavailable ? undefined : subjects.get(slug);
      return <li key={slug}><Link className={styles.subject} href={subject ? `/offers?subject_id=${subject.subject_id}` : publicContact.whatsappHref} aria-label={subject ? copy.subjectExplore(detail.title) : copy.subjectAsk(detail.title)}><div className={styles.subjectName}><h2>{detail.title}</h2><p className={styles.subjectTopics}>{detail.topics}</p></div><div className={styles.subjectDescription}><p>{detail.description}</p><span className={styles.subjectAction}>{subject ? copy.subjectAction : copy.subjectAskAction}</span></div><svg className={styles.subjectArrow} viewBox="0 0 32 32" aria-hidden="true"><path d="M6 16h20M18 8l8 8-8 8" /></svg></Link></li>;
    })}</ul>
    <p className={styles.allCourses}><Link className={styles.textLink} href="/offers">{copy.allCourses}</Link></p>
    <CourseHelp />
  </PublicShell>;
}
