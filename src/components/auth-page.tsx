import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { AuthForm } from './auth-form';
import { authCopy as copy } from '@/locales/auth';
import styles from './auth.module.css';

export function AuthPage({ mode, unavailable, forbidden, returnTo }: { mode: 'login' | 'signup'; unavailable?: boolean; forbidden?: boolean; returnTo?: string }) {
  const text = copy[mode];
  return <div className={styles.authPage}>
    <Link href="/" className={styles.brand} aria-label={copy.home}><BrandLogo /></Link>
    <main className={styles.authLayout}>
      <aside className={styles.authAside}><h2>{text.asideTitle}</h2><p>{text.asideBody}</p></aside>
      <section className={styles.authPanel} aria-labelledby="auth-heading">
        <h1 id="auth-heading">{text.title}</h1>
        <p className={styles.description}>{text.description}</p>
        <AuthForm mode={mode} unavailable={unavailable} forbidden={forbidden} returnTo={returnTo} />
        <p className={styles.alternative}>{text.alternative} <Link href={mode === 'login' ? '/signup' : '/login'}>{text.link}</Link></p>
      </section>
    </main>
  </div>;
}
