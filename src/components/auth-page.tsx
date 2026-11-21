import { LanguageSwitch } from '@/components/site-language';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { AuthForm } from './auth-form';
import { publicAuth } from '@/locales/ar-public';
import { getSiteLanguage } from '@/server/site-language';

import styles from './auth.module.css';

export async function AuthPage({ mode, unavailable, forbidden, returnTo }: { mode: 'login' | 'signup' | 'recover'; unavailable?: boolean; forbidden?: boolean; returnTo?: string }) {
  const language = await getSiteLanguage();
  const copy = publicAuth(language);
  const text = copy[mode];
  return <><LanguageSwitch /><main className={styles.authLayout}>
      <section className={styles.authPanel} aria-labelledby="auth-heading">
        <div className={styles.authMasthead}>
          <BrandLogo compact />
          <Link href="/"><span aria-hidden="true">{language === 'ar' ? '→ ' : '← '}</span>{copy.home}</Link>
        </div>
        <h1 id="auth-heading">{text.title}</h1>
        <p className={styles.description}>{text.description}</p>
        <AuthForm mode={mode} unavailable={unavailable} forbidden={forbidden} returnTo={returnTo} />
        <div className={styles.authLinks}>
          {mode === 'login' && <Link href="/auth/recover">{language === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot your password?'}</Link>}
          <p className={styles.alternative}>{text.alternative} <Link href={mode === 'login' ? '/signup' : '/login'}>{text.link}</Link></p>
        </div>
      </section>
  </main></>;
}
