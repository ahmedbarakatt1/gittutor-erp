import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicShell, CatalogUnavailable } from '@/components/catalog/public-shell';
import { catalogCopy as copy } from '@/locales/catalog';
import { requireAccount } from '@/server/auth';
import { serverSupabase } from '@/server/supabase';
import { getPublicTutor, type PublicTutor } from '@/modules/catalog/queries';
import styles from '@/components/catalog/catalog.module.css';

export const metadata: Metadata = { title: 'Tutor profile | Git Tutor' };
export default async function PublicTutorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccount(undefined, `/tutors/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let tutor: PublicTutor | null = null; let unavailable = false;
  try { tutor = await getPublicTutor(await serverSupabase(), id); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'NOT_FOUND') notFound(); unavailable = true; }
  return <PublicShell>
    <p className={styles.breadcrumb}><Link className={styles.textLink} href="/offers">{copy.back}</Link></p>
    {unavailable || !tutor ? <CatalogUnavailable retry={`/tutors/${id}`} /> : <>
      <div className={styles.intro}>
        <h1 className={styles.tutorTitle}>{copy.tutorTitle} {tutor.display_name}.</h1>
        <p className={styles.bio}>{tutor.bio}</p>
      </div>
      <section>
        <h2>{copy.teachingSubjects}</h2>
        <div className={styles.subjectLinks}>
          {tutor.subjects.map(subject =>
            <Link key={subject.subject_id} className={styles.textLink} href={`/offers?subject_id=${subject.subject_id}`}>{subject.title}</Link>
          )}
        </div>
      </section>
      <section className={styles.results}>
        <h2>{copy.tutorOffers}</h2>
        <p>{copy.tutorOfferHint}</p>
      </section>
    </>}
  </PublicShell>;
}
