import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/catalog/public-shell';
import { CourseHelp } from '@/components/public-contact';
import { catalogCopy as copy } from '@/locales/catalog';
import styles from '@/components/catalog/catalog.module.css';

export const metadata: Metadata = {
  title: 'Subjects | Git Tutor',
  description: 'Tutoring around your own course material. Explore our study areas or request help with another topic.',
};

export default function SubjectsPage() {
  const subjects = Object.entries(copy.subjectDetails).sort(([, a], [, b]) => a.order - b.order);

  return <PublicShell active="subjects">
    <div className={`${styles.intro} ${styles.subjectIntro}`}>
      <h1>{copy.subjectsTitle}</h1>
      <div>
        <p>{copy.subjectsDescription}</p>
        <Link className={styles.textLink} href="/learn/requests">{copy.anotherSubject}</Link>
      </div>
    </div>
    <ul className={styles.subjectList}>
      {subjects.map(([slug, detail]) => (
        <li key={slug}>
          <Link className={styles.subject} href={`/learn/requests?topic=${encodeURIComponent(detail.title)}`}
            aria-label={copy.subjectExplore(detail.title)} aria-describedby={`${slug}-topics`}>
            <div className={styles.subjectName}>
              <h2>{detail.title}</h2>
              <p className={styles.subjectTopics} id={`${slug}-topics`}>{detail.topics}</p>
            </div>
            <p className={styles.subjectDescription}>{detail.description}</p>
            <svg className={styles.subjectArrow} viewBox="0 0 32 32" aria-hidden="true">
              <path d="M6 16h20M18 8l8 8-8 8" />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
    <p className={styles.allCourses}><Link className={styles.textLink} href="/offers">{copy.allCourses}</Link></p>
    <CourseHelp />
  </PublicShell>;
}
