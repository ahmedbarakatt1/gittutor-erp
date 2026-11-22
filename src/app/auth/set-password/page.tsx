import { landingForRoles } from '@/server/http';
import { pageMetadata } from '@/server/page-metadata';
import { LanguageSwitch } from '@/components/site-language';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { requireAccount } from '@/server/auth';
import { SetPasswordForm } from '@/components/auth-form';
import { dashboardLabel, publicAuth } from '@/locales/ar-public';
import { getSiteLanguage } from '@/server/site-language';

import styles from '@/components/auth.module.css';

export const generateMetadata = pageMetadata({ title: 'Set your password | Git Tutor', robots: { index: false, follow: false } });

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ staff_invitation_id?: string }> }) {
  const workspace = landingForRoles((await requireAccount()).roles);
  const requestedId = (await searchParams).staff_invitation_id;
  const invitationId = typeof requestedId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId) ? requestedId : undefined;
  const language = await getSiteLanguage();
  const copy = publicAuth(language);
  return <><LanguageSwitch workspaceHome={workspace} /><div className={styles.authPage}><Link className={styles.brand} href={workspace || '/'} aria-label={workspace ? dashboardLabel(language) : copy.home}><BrandLogo /></Link><main className={styles.verification}><h1>{copy.passwordSetup.title}</h1><p className={styles.description}>{copy.passwordSetup.description}</p><SetPasswordForm staffInvitationId={invitationId} /></main></div></>;
}
