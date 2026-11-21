'use client';
import { useSiteLanguage } from '@/components/site-language';
import { requestTranslator } from '@/locales/ar-public-requests';
import Link from 'next/link';
import styles from './workspace.module.css';
export function RequestEntry({ staff }: { staff?: 'admin' | 'service' }) {
  const text = requestTranslator(useSiteLanguage());
  return <section className={styles.entry}>
    <div>
      <h2>{text(staff ? 'Incoming session requests' : 'Bring the material you need help with.')}</h2>
      <p>{text(staff ? 'Review learning briefs and uploaded slides, reply to families and arrange sessions.' : 'Start with your subject, slides and preferred times. We’ll help arrange a suitable tutor and session.')}</p>
    </div>
    <Link className={styles.primary} href={`/${staff || 'learn'}/requests`}>{text(staff ? 'Open request queue' : 'Request a session')}</Link>
  </section>;
}
