import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMinorUnits } from '@/modules/shared/format';
import { catalogCopy as copy } from '@/locales/catalog';
import styles from './catalog.module.css';
import { PublicContactLinks } from '../public-contact';

export function PublicShell({ children, active }: { children: ReactNode; active?: 'subjects' | 'offers' }) {
  return <div className={styles.shell}>
    <a className="skip-link" href="#main">{copy.skip}</a>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label={copy.home}><BrandLogo /></Link><nav aria-label={copy.navigation}>
      <Link href="/subjects" aria-current={active === 'subjects' ? 'page' : undefined}>{copy.subjects}</Link>
      <Link href="/offers" aria-current={active === 'offers' ? 'page' : undefined}>{copy.offers}</Link>
      <Link href="/login">{copy.account}</Link>
    </nav></header>
    <main id="main" className={styles.main}>{children}</main>
    <footer className={styles.footer}><div><p>{copy.footer}</p><PublicContactLinks /></div><Link className={styles.textLink} href="/apply-to-teach">{copy.teach}</Link></footer>
  </div>;
}

export function CatalogUnavailable({ retry = '/offers' }: { retry?: string }) {
  return <section className={styles.empty} role="alert"><h2>{copy.unavailable}</h2><p>{copy.unavailableDescription}</p><a className={styles.textLink} href={retry}>{copy.retry}</a></section>;
}

export function CatalogLoading() { return <PublicShell><p className={styles.empty} role="status">{copy.loading}</p></PublicShell>; }
export function CatalogNotFound() { return <PublicShell><section className={styles.empty}><h1>{copy.notFound}</h1><p>{copy.notFoundDescription}</p><Link className={styles.button} href="/offers">{copy.offers}</Link></section></PublicShell>; }

export const formatTuition = (minor: number, currency = 'EGP') => formatMinorUnits(minor, currency, copy.locale, true);
