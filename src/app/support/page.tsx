import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { PublicContactLinks } from '@/components/public-contact';
import { ChannelWorkspace } from '@/components/support/channel-workspace';
import styles from '@/components/support/public-support.module.css';
import { catalogCopy } from '@/locales/catalog';
import { publicContact } from '@/locales/contact';
import { publicSupportCopy as copy, supportCopy } from '@/locales/support';

export const metadata: Metadata = { title: copy.pageTitle };

export default function Page() {
  return <div className={styles.page}>
    <a className="skip-link" href="#main">{catalogCopy.skip}</a>
    <header className={styles.header}>
      <div className={styles.frame}>
        <Link href="/" className="brand-link" aria-label={catalogCopy.home}><BrandLogo compact /></Link>
        <nav aria-label={catalogCopy.navigation}>
          <Link href="/subjects">{catalogCopy.subjects}</Link>
          <Link href="/login">{copy.account}</Link>
        </nav>
      </div>
    </header>
    <main id="main" className={`${styles.main} ${styles.frame}`}>
      <div className={styles.intro}>
        <h1>{supportCopy.title}</h1>
        <p>{supportCopy.intro}</p>
      </div>
      <ChannelWorkspace publicEntry />
    </main>
    <footer className={styles.footer}>
      <div className={styles.frame}>
        <h2>{publicContact.label}</h2>
        <PublicContactLinks />
      </div>
    </footer>
  </div>;
}
