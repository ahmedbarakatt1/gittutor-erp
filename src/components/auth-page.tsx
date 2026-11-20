import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { AuthForm } from './auth-form';
import { authCopy as copy } from '@/locales/auth';
import styles from './auth.module.css';

export function AuthPage({ mode, unavailable, forbidden, returnTo }: { mode: 'login' | 'signup' | 'recover'; unavailable?: boolean; forbidden?: boolean; returnTo?: string }) {
  const text = copy[mode];
  return <main className={styles.authLayout}>
      <section className={styles.authPanel} aria-labelledby="auth-heading">
        <div className={styles.authMasthead}>
          <BrandLogo compact />
          <Link href="/"><span aria-hidden="true">← </span>{copy.home}</Link>
        </div>
        <h1 id="auth-heading">{text.title}</h1>
        <p className={styles.description}>{text.description}</p>
        <AuthForm mode={mode} unavailable={unavailable} forbidden={forbidden} returnTo={returnTo} />
        <div className={styles.authLinks}>
          {mode === 'login' && <Link href="/auth/recover">Forgot your password?</Link>}
          <p className={styles.alternative}>{text.alternative} <Link href={mode === 'login' ? '/signup' : '/login'}>{text.link}</Link></p>
        </div>
      </section>
  </main>;
}
