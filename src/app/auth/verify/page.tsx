import { publicWorkspaceHome } from '@/server/auth';
import { pageMetadata } from '@/server/page-metadata';
import { LanguageSwitch } from '@/components/site-language';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { dashboardLabel, publicAuth } from '@/locales/ar-public';
import { getSiteLanguage } from '@/server/site-language';

import styles from '@/components/auth.module.css';

export const generateMetadata = pageMetadata({ title: 'Verify your email | Git Tutor', robots: { index: false, follow: false } });

export default async function VerificationPage() {
  const workspace = await publicWorkspaceHome();
  const language = await getSiteLanguage();
  const copy = publicAuth(language);
  return <><LanguageSwitch workspaceHome={workspace} /><div className={styles.authPage}>
    <Link href={workspace || '/'} className={styles.brand} aria-label={workspace ? dashboardLabel(language) : copy.home}><BrandLogo /></Link>
    <main className={styles.verification}>
      <h1>{copy.verification.title}</h1>
      <p>{copy.verification.description}</p>
      <p className={styles.description}>{copy.verification.reminder}</p>
      <Link className={styles.primary} href="/login">{copy.verification.action}</Link>
    </main>
  </div></>;
}
