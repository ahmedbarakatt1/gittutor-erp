import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/catalog/public-shell';
import { catalogCopy as copy } from '@/locales/catalog';
import styles from '@/components/catalog/catalog.module.css';
import { CourseHelp } from '@/components/public-contact';

export const metadata: Metadata = { title: 'Subjects | Git Tutor', description: 'Tutoring around your own course material. Explore our study areas or request help with another topic.' };
export default function SubjectsPage() {
  return <PublicShell active="subjects"><div className={`${styles.intro} ${styles.subjectIntro}`}><h1>{copy.subjectsTitle}</h1><p>{copy.subjectsDescription}</p></div>
    <ul className={styles.subjectList}>{Object.entries(copy.subjectDetails).sort(([, a], [, b]) => a.order - b.order).map(([slug, detail]) => <li key={slug}><Link className={styles.subject} href={`/learn/requests?topic=${encodeURIComponent(detail.title)}`} aria-label={copy.subjectExplore(detail.title)}><div className={styles.subjectName}><h2>{detail.title}</h2><p className={styles.subjectTopics}>{detail.topics}</p></div><div className={styles.subjectDescription}><p>{detail.description}</p><span className={styles.subjectAction}>{copy.subjectAction}</span></div><svg className={styles.subjectArrow} viewBox="0 0 32 32" aria-hidden="true"><path d="M6 16h20M18 8l8 8-8 8" /></svg></Link></li>)}</ul>
    <section className={styles.terms}><h2>Studying something else?</h2><p>Share your subject, lecture slides or assignment brief. We’ll review it and let you know how we can help.</p><p className={styles.allCourses}><Link className={styles.button} href="/learn/requests">Request help with another subject</Link></p></section>
    <p className={styles.allCourses}><Link className={styles.textLink} href="/offers">{copy.allCourses}</Link></p><CourseHelp />
  </PublicShell>;
}
