import { BrandLogo } from '@/components/brand-logo';
import type { Metadata } from 'next';
import Link from 'next/link';
import { authCopy as copy } from '@/locales/auth';
import styles from '@/components/auth.module.css';

export const metadata: Metadata = { title: 'Verify your email | Git Tutor', robots: { index: false, follow: false } };

export default function VerificationPage() {
  return <div className={styles.authPage}>
    <Link href="/" className={styles.brand} aria-label={copy.home}><BrandLogo /></Link>
    <main className={styles.verification}>
      <h1>{copy.verification.title}</h1>
      <p>{copy.verification.description}</p>
      <p className={styles.description}>{copy.verification.reminder}</p>
      <Link className={styles.primary} href="/login">{copy.verification.action}</Link>
    </main>
  </div>;
}
