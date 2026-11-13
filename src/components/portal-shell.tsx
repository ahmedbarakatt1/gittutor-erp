import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from './auth-form';
import { authCopy as copy, identityCopy, type PortalKind } from '@/locales/auth';
import type { Account } from '@/server/auth';
import styles from './auth.module.css';
import { catalogCopy } from '@/locales/catalog';
import { bookingCopy } from '@/locales/booking';
import { packageCopy } from '@/locales/packages';
import { bookingStaffCopy } from '@/locales/booking-staff';
import { paymentCopy } from '@/locales/payments';
import { fileCopy } from '@/locales/files';
import { meetingCopy } from '@/locales/meetings';
import { financeCopy } from '@/locales/finance';
import { payrollCopy } from '@/locales/payroll';
import { operationsCopy } from '@/locales/teaching-operations';

export function PortalShell({ kind, account, children, title, description, activePath, showAccount = true }: { kind: PortalKind; account: Account; children?: ReactNode; title?: string; description?: string; activePath?: string; showAccount?: boolean }) {
  const text = copy.portal[kind];
  const learnerWorkspace = account.roles.some(role => role === 'student' || role === 'guardian');
  const authorizedWorkspaces: PortalKind[] = [];
  if (account.roles.some(role => role === 'student' || role === 'guardian')) authorizedWorkspaces.push('learn');
  if (account.roles.includes('tutor')) authorizedWorkspaces.push('tutor');
  if (account.roles.includes('customer_service')) authorizedWorkspaces.push('service');
  if (account.roles.includes('admin')) authorizedWorkspaces.push('admin');
  return <div className={`${styles.portal} ${kind === 'learn' ? '' : styles.staff}`}>
    <a className="skip-link" href="#account">{copy.skip}</a>
    <header className={styles.portalHeader}>
      <div className={styles.portalIdentity}>
        <Link className={styles.brand} href="/" aria-label={copy.home}><BrandLogo compact /></Link>
        <span className={styles.workspaceName}>{text.workspace}</span>
      </div>
      <SignOutButton />
    </header>
    <div className={styles.portalLayout}>
      <nav className={styles.portalNav} aria-label={text.workspace}>
        {(kind==='admin'||kind==='service')&&<Link href={`/${kind}/customers`} aria-current={activePath===`/${kind}/customers`?'page':undefined}>Customers</Link>}
        {(kind==='admin'||kind==='service')&&<Link href={`/${kind}/support`} aria-current={activePath===`/${kind}/support`?'page':undefined}>Support inbox</Link>}
        {kind==='learn'&&<Link href="/learn/support" aria-current={activePath==='/learn/support'?'page':undefined}>Support</Link>}
        {kind!=='service'&&<Link href={`/${kind}/exports`} aria-current={activePath===`/${kind}/exports`?'page':undefined}>Your exports</Link>}
        {kind==='admin'&&<><Link href="/admin/sessions" aria-current={activePath==='/admin/sessions'?'page':undefined}>Session history</Link><Link href="/admin/campaigns" aria-current={activePath==='/admin/campaigns'?'page':undefined}>Campaigns</Link><Link href="/admin/students" aria-current={activePath==='/admin/students'?'page':undefined}>Student progression</Link><Link href="/admin/team" aria-current={activePath==='/admin/team'?'page':undefined}>Team</Link></>}
        {(kind !== 'learn' || learnerWorkspace) && <Link href={`/${kind}`} aria-current={!activePath || activePath === `/${kind}` ? 'page' : undefined}>{copy.portal.account}</Link>}
        {kind === 'admin' && <Link href="/admin/finance" aria-current={activePath === '/admin/finance' ? 'page' : undefined}>{financeCopy.nav}</Link>}
        {kind === 'admin' && <Link href="/admin/catalog" aria-current={activePath === '/admin/catalog' ? 'page' : undefined}>{catalogCopy.admin.nav}</Link>}
        {kind === 'admin' && <Link href="/admin/integrations" aria-current={activePath === '/admin/integrations' ? 'page' : undefined}>{meetingCopy.integrations}</Link>}
        {(kind === 'admin' || kind === 'tutor') && <Link href={`/${kind}/pay`} aria-current={activePath === `/${kind}/pay` ? 'page' : undefined}>{payrollCopy.nav}</Link>}
        {(kind === 'admin' || kind === 'tutor') && <Link href={`/${kind}/teaching`} aria-current={activePath === `/${kind}/teaching` ? 'page' : undefined}>{operationsCopy.nav}</Link>}
        <Link href={`/${kind}/notifications`} aria-current={activePath === `/${kind}/notifications` ? 'page' : undefined}>Your updates</Link>
        {kind === 'admin' && <Link href="/admin/notifications-operations" aria-current={activePath === '/admin/notifications-operations' ? 'page' : undefined}>Notification operations</Link>}
        {kind === 'admin' && <Link href="/admin/schedule" aria-current={activePath === '/admin/schedule' ? 'page' : undefined}>{bookingStaffCopy.adminNav}</Link>}
        {kind === 'tutor' && <Link href="/tutor/schedule" aria-current={activePath === '/tutor/schedule' ? 'page' : undefined}>{bookingStaffCopy.tutorNav}</Link>}
        {kind === 'learn' && learnerWorkspace && <Link href="/learn/bookings" aria-current={activePath === '/learn/bookings' ? 'page' : undefined}>{bookingCopy.nav}</Link>}
        {((kind === 'learn' && learnerWorkspace) || kind === 'admin') && <Link href={`/${kind}/packages`} aria-current={activePath === `/${kind}/packages` ? 'page' : undefined}>{packageCopy.nav}</Link>}
        {kind === 'learn' && learnerWorkspace && <Link href="/learn/files" aria-current={activePath === '/learn/files' ? 'page' : undefined}>{fileCopy.nav}</Link>}
        {(kind === 'learn' || kind === 'service' || kind === 'admin') && <Link href={`/${kind}/payments`} aria-current={activePath === `/${kind}/payments` ? 'page' : undefined}>{paymentCopy.nav}</Link>}
        {(kind === 'learn' || kind === 'admin') && <Link href={`/${kind}/refunds`} aria-current={activePath === `/${kind}/refunds` ? 'page' : undefined}>{paymentCopy.refundsNav}</Link>}
        {kind === 'learn' && learnerWorkspace && <Link href="/learn#learners">{copy.portal.learnerTitle}</Link>}
        {kind === 'learn' && <Link href="/apply-to-teach">{identityCopy.application.nav}</Link>}
        {authorizedWorkspaces.filter(workspace => workspace !== kind).map(workspace => <Link key={workspace} href={`/${workspace}`}>{copy.portal[workspace].workspace}</Link>)}
      </nav>
      <main id="account" className={styles.portalMain}>
        <h1>{title || text.title}</h1>
        <p className={styles.description}>{description || text.description}</p>
        {showAccount && <section className={styles.accountGrid} aria-labelledby="account-heading">
          <h2 id="account-heading">{copy.portal.account}</h2>
          <dl>
            <div><dt>{copy.portal.accountId}</dt><dd className={styles.accountReference} data-testid="account-id">{account.account_id}</dd></div>
            <div><dt>{copy.portal.access}</dt><dd>{account.roles.map((role) => copy.portal.roleLabels[role] || role).join(', ')}</dd></div>
            <div><dt>{copy.portal.locale}</dt><dd>{account.locale}</dd></div>
            <div><dt>{copy.portal.verified}</dt><dd className={styles.status}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="m7.5 12 3 3 6-6" /></svg>{copy.portal.verified}</dd></div>
          </dl>
        </section>}
        {kind === 'learn' && showAccount && <section id="learners" className={styles.section} aria-labelledby="learners-heading">
          <h2 id="learners-heading">{copy.portal.learnerTitle}</h2>
          <p>{copy.portal.learnerDescription}</p>
          {account.authorized_learner_ids.length ? <ul className={styles.learnerList}>{account.authorized_learner_ids.map((id) => <li key={id}><span>{copy.portal.learnerReference}</span><strong data-testid="learner-id">{id}</strong></li>)}</ul> : <p>{copy.portal.noLearners}</p>}
        </section>}
        {children}
      </main>
    </div>
  </div>;
}
