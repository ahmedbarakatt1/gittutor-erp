import { pageMetadata } from '@/server/page-metadata';
import { LanguageSwitch } from '@/components/site-language';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { PublicContactLinks } from '@/components/public-contact';
import { ChannelWorkspace } from '@/components/support/channel-workspace';
import styles from '@/components/support/public-support.module.css';
import { getSiteLanguage } from '@/server/site-language';
import { dashboardLabel, publicCatalog, contactMessages } from '@/locales/ar-public';

import { publicSupportCopy as copy, supportCopy } from '@/locales/support';
import { publicWorkspaceHome } from '@/server/auth';

export const generateMetadata = pageMetadata({ title: copy.pageTitle });

export default async function Page() {
  const language = await getSiteLanguage();
  const ar = language === 'ar';
  const catalogCopy = publicCatalog(language);
  const publicContact = contactMessages(language);
  const workspace = await publicWorkspaceHome();
  const dashboard = dashboardLabel(language);
  return <div className={styles.page}>
    <a className="skip-link" href="#main">{catalogCopy.skip}</a>
      <LanguageSwitch workspaceHome={workspace} />
    <header className={styles.header}>
      <div className={styles.frame}>
        <Link href={workspace || '/'} className="brand-link" aria-label={workspace ? dashboard : catalogCopy.home}><BrandLogo compact /></Link>
        <nav aria-label={catalogCopy.navigation}>
          <Link href="/subjects">{catalogCopy.subjects}</Link>
          <Link href={workspace || '/login'}>{workspace ? dashboard : ar ? 'حسابك' : copy.account}</Link>
        </nav>
      </div>
    </header>
    <main id="main" className={`${styles.main} ${styles.frame}`}>
      <div className={styles.intro}>
        <h1>{ar ? 'كيف نساعدك؟' : supportCopy.title}</h1>
        <p>{ar ? 'إذا كان سؤالك عن الحجز أو نوع الحصة أو رفع المواد الدراسية، اختر الطريقة التي تناسبك للتواصل معنا.' : supportCopy.intro}</p>
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
