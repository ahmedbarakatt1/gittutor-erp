import { LanguageSwitch } from '@/components/site-language';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMinorUnits } from '@/modules/shared/format';
import { publicCatalog } from '@/locales/ar-public';
import type { SiteLanguage } from '@/locales/language';

import styles from './catalog.module.css';
import { PublicContactLinks } from '../public-contact';

export function PublicShell({ children, active, language = 'en' }: { language?: SiteLanguage; children: ReactNode; active?: 'subjects' | 'offers' }) {
  const copy = publicCatalog(language);
  return <div className={styles.shell}>
    <a className="skip-link" href="#main">{copy.skip}</a>
      <LanguageSwitch />
    <header className={styles.header}><div className={styles.frame}><Link className={styles.brand} href="/" aria-label={copy.home}><BrandLogo compact /></Link><nav aria-label={copy.navigation}>
      <Link href="/subjects" aria-current={active === 'subjects' ? 'page' : undefined}>{copy.subjects}</Link>
      <Link href="/offers" aria-current={active === 'offers' ? 'page' : undefined}>{copy.offers}</Link>
      <Link href="/login">{copy.account}</Link>
    </nav></div></header>
    <main id="main" className={`${styles.main} ${styles.frame}`}>{children}</main>
    <footer className={styles.footer}><div className={styles.frame}><div><p>{copy.footer}</p><PublicContactLinks /></div><Link className={styles.textLink} href="/apply-to-teach">{copy.teach}</Link></div></footer>
  </div>;
}

export function CatalogUnavailable({ retry = '/offers', language = 'en' }: { retry?: string; language?: SiteLanguage }) {
  const copy = publicCatalog(language);
  return <section className={styles.empty} role="alert"><h2>{copy.unavailable}</h2><p>{copy.unavailableDescription}</p><a className={styles.textLink} href={retry}>{copy.retry}</a></section>;
}

export function CatalogLoading({ language = 'en' }: { language?: SiteLanguage }) { const copy = publicCatalog(language); return <PublicShell language={language}><p className={styles.empty} role="status">{copy.loading}</p></PublicShell>; }
export function CatalogNotFound({ language = 'en' }: { language?: SiteLanguage }) { const copy = publicCatalog(language); return <PublicShell language={language}><section className={styles.empty}><h1>{copy.notFound}</h1><p>{copy.notFoundDescription}</p><Link className={styles.button} href="/offers">{copy.offers}</Link></section></PublicShell>; }

export const formatTuition = (minor: number, currency = 'EGP', language: SiteLanguage = 'en') => formatMinorUnits(minor, currency, language === 'ar' ? 'ar-EG' : 'en-EG', true);
