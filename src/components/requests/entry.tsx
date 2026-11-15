import Link from 'next/link';
import styles from './workspace.module.css';
export function RequestEntry({ staff }: { staff?: 'admin' | 'service' }) {
  return <section className={styles.reply}><h2>{staff ? 'Incoming session requests' : 'Bring the material you need help with.'}</h2><p>{staff ? 'Review learning briefs and uploaded slides, reply to families and arrange sessions.' : 'Start with your subject, slides and preferred times. We’ll help arrange a suitable tutor and session.'}</p><Link className={styles.primary} href={`/${staff || 'learn'}/requests`}>{staff ? 'Open request queue' : 'Request a session'}</Link></section>;
}
