import { landingForRoles } from '@/server/http';
import { pageMetadata } from '@/server/page-metadata';
import { LanguageSwitch } from '@/components/site-language';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { AuthUnavailableError, getCurrentAccount } from '@/server/auth';
import { TutorApplicationForm } from '@/components/identity-workspaces';
import { getSiteLanguage } from '@/server/site-language';
import { dashboardLabel, publicAuth, applicationMessages } from '@/locales/ar-public';
import styles from '@/components/auth.module.css';

export const generateMetadata = pageMetadata({ title: 'Apply to teach | Git Tutor' });

export default async function ApplyToTeachPage() {
  const language = await getSiteLanguage();
  const authCopy = publicAuth(language);
  const copy = applicationMessages(language);
  let account = null;
  let unavailable = false;
  try { account = await getCurrentAccount(); }
  catch (error) { if (!(error instanceof AuthUnavailableError)) throw error; unavailable = true; }
  const workspace = account ? landingForRoles(account.roles) : undefined;
  return <><LanguageSwitch workspaceHome={workspace} /><div className={styles.authPage}>
    <Link className={styles.brand} href={workspace || '/'} aria-label={workspace ? dashboardLabel(language) : authCopy.home}><BrandLogo /></Link>
    <main className={styles.applicationPage}>
      <h1>{copy.title}</h1><p className={styles.description}>{copy.description}</p>
      <p className={styles.description}>{copy.verification}</p>
      {account ? <TutorApplicationForm /> : <div className={styles.applicationSignIn}>{unavailable && <p className={styles.error} role="status">{authCopy.error.unavailable}</p>}<Link className={styles.primary} href="/login">{copy.signIn}</Link></div>}
    </main>
  </div></>;
}
