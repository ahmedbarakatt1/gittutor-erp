import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from './auth-form';
import { PortalNavigation, type NavigationGroup } from './portal-navigation';
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

function navigationFor(kind: PortalKind, learnerWorkspace: boolean, otherWorkspaces: PortalKind[]): NavigationGroup[] {
  const n = copy.navigation;
  const local = (path: string, label: string) => ({ href: '/' + kind + path, label });
  const account = local('', copy.portal.account);
  const requests = local('/requests', n.requests);
  const updates = local('/notifications', n.updates);
  const payments = local('/payments', paymentCopy.nav);
  const refunds = local('/refunds', paymentCopy.refundsNav);
  const packages = local('/packages', packageCopy.nav);
  const exports = local('/exports', n.exports);
  const customers = local('/customers', n.customers);
  const inbox = local('/support', n.supportInbox);
  const teaching = local('/teaching', operationsCopy.nav);
  const pay = local('/pay', payrollCopy.nav);
  const groups: NavigationGroup[] = [];
  if (kind === 'admin') {
    groups.push(
      { label: n.workspace, links: [local('', n.dashboard), requests, local('/schedule', bookingStaffCopy.adminNav), customers, inbox] },
      { label: n.sessions, links: [local('/sessions', n.history), teaching, packages, local('/catalog', catalogCopy.admin.nav)] },
      { label: n.money, links: [payments, refunds, local('/finance', financeCopy.nav), pay] },
      { label: n.records, links: [local('/students', n.students), local('/team', n.team), local('/campaigns', n.campaigns), local('/workflow', n.archive), exports] },
      { label: n.manage, links: [local('/access', n.staff), local('/integrations', meetingCopy.integrations), updates, local('/notifications-operations', n.notifications)] }
    );
  } else if (kind === 'learn') {
    if (learnerWorkspace) groups.push({ label: n.sessions, links: [requests, local('/bookings', bookingCopy.nav), local('/files', fileCopy.nav), packages] });
    groups.push(
      { label: n.money, links: [payments, refunds] },
      { label: n.service, links: [...(learnerWorkspace ? [account, local('#learners', copy.portal.learnerTitle)] : []),
        updates, local('/support', n.support), exports, { href: '/apply-to-teach', label: identityCopy.application.nav }] }
    );
  } else if (kind === 'tutor') {
    groups.push(
      { label: n.sessions, links: [local('/schedule', bookingStaffCopy.tutorNav), teaching, pay] },
      { label: n.workspace, links: [account, updates, exports] }
    );
  } else {
    groups.push({ label: n.workspace, links: [account, requests, customers, inbox, payments, updates] });
  }
  if (otherWorkspaces.length) groups.push({ label: n.switchWorkspace, links: otherWorkspaces.map(target => ({ href: '/' + target, label: copy.portal[target].workspace })) });
  return groups;
}

export function PortalShell({ kind, account, children, title, description, activePath, showAccount = true }: { kind: PortalKind; account: Account; children?: ReactNode; title?: string; description?: string; activePath?: string; showAccount?: boolean }) {
  const text = copy.portal[kind];
  const learnerWorkspace = account.roles.some(role => role === 'student' || role === 'guardian');
  const authorizedWorkspaces: PortalKind[] = [];
  if (account.roles.some(role => role === 'student' || role === 'guardian')) authorizedWorkspaces.push('learn');
  if (account.roles.includes('tutor')) authorizedWorkspaces.push('tutor');
  if (account.roles.includes('customer_service')) authorizedWorkspaces.push('service');
  if (account.roles.includes('admin')) authorizedWorkspaces.push('admin');
  const groups = navigationFor(kind, learnerWorkspace, authorizedWorkspaces.filter(workspace => workspace !== kind));
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
      <PortalNavigation key={activePath || kind} workspace={text.workspace} groups={groups} activePath={activePath || `/${kind}`} />
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
