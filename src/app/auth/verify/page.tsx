import { pageMetadata } from '@/server/page-metadata';
import { LanguageSwitch } from '@/components/site-language';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { publicAuth } from '@/locales/ar-public';
import { getSiteLanguage } from '@/server/site-language';

import styles from '@/components/auth.module.css';

export const generateMetadata = pageMetadata({ title: 'Verify your email | Git Tutor', robots: { index: false, follow: false } });

export default async function VerificationPage() {
  const copy = publicAuth(await getSiteLanguage());
  return <><LanguageSwitch /><div className={styles.authPage}>
    <Link href="/" className={styles.brand} aria-label={copy.home}><BrandLogo /></Link>
    <main className={styles.verification}>
      <h1>{copy.verification.title}</h1>
      <p>{copy.verification.description}</p>
      <p className={styles.description}>{copy.verification.reminder}</p>
      <Link className={styles.primary} href="/login">{copy.verification.action}</Link>
    </main>
  </div></>;
}
