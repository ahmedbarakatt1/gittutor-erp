import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthUnavailableError, getCurrentAccount } from '@/server/auth';
import { TutorApplicationForm } from '@/components/identity-workspaces';
import { authCopy, identityCopy as copy } from '@/locales/auth';
import styles from '@/components/auth.module.css';

export const metadata: Metadata = { title: 'Apply to teach | Git Tutor' };

export default async function ApplyToTeachPage() {
  let account = null;
  let unavailable = false;
  try { account = await getCurrentAccount(); }
  catch (error) { if (!(error instanceof AuthUnavailableError)) throw error; unavailable = true; }
  return <div className={styles.authPage}>
    <Link className={styles.brand} href="/" aria-label={authCopy.home}><span>Git</span> Tutor.</Link>
    <main className={styles.applicationPage}>
      <h1>{copy.application.title}</h1><p className={styles.description}>{copy.application.description}</p>
      <p className={styles.description}>{copy.application.verification}</p>
      {account ? <TutorApplicationForm /> : <div className={styles.applicationSignIn}>{unavailable && <p className={styles.error} role="status">{authCopy.error.unavailable}</p>}<Link className={styles.primary} href="/login">{copy.application.signIn}</Link></div>}
    </main>
  </div>;
}
