import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from './auth-form';
import { authCopy as copy, identityCopy, type PortalKind } from '@/locales/auth';
import type { Account } from '@/server/auth';
import styles from './auth.module.css';

export function PortalShell({ kind, account, children }: { kind: PortalKind; account: Account; children?: ReactNode }) {
  const text = copy.portal[kind];
  const authorizedWorkspaces: PortalKind[] = [];
  if (account.roles.some(role => role === 'student' || role === 'guardian')) authorizedWorkspaces.push('learn');
  if (account.roles.includes('tutor')) authorizedWorkspaces.push('tutor');
  if (account.roles.includes('customer_service')) authorizedWorkspaces.push('service');
  if (account.roles.includes('admin')) authorizedWorkspaces.push('admin');
  return <div className={`${styles.portal} ${kind === 'learn' ? '' : styles.staff}`}>
    <a className="skip-link" href="#account">{copy.skip}</a>
    <header className={styles.portalHeader}>
      <div className={styles.portalIdentity}>
        <Link className={styles.brand} href="/" aria-label={copy.home}><span>Git</span> Tutor.</Link>
        <span className={styles.workspaceName}>{text.workspace}</span>
      </div>
      <SignOutButton />
    </header>
    <div className={styles.portalLayout}>
      <nav className={styles.portalNav} aria-label={text.workspace}>
        <Link href={`/${kind}`} aria-current="page">{copy.portal.account}</Link>
        {kind === 'learn' && <a href="#learners">{copy.portal.learnerTitle}</a>}
        {kind === 'learn' && <Link href="/apply-to-teach">{identityCopy.application.nav}</Link>}
        {authorizedWorkspaces.filter(workspace => workspace !== kind).map(workspace => <Link key={workspace} href={`/${workspace}`}>{copy.portal[workspace].workspace}</Link>)}
      </nav>
      <main id="account" className={styles.portalMain}>
        <h1>{text.title}</h1>
        <p className={styles.description}>{text.description}</p>
        <section className={styles.accountGrid} aria-labelledby="account-heading">
          <h2 id="account-heading">{copy.portal.account}</h2>
          <dl>
            <div><dt>{copy.portal.accountId}</dt><dd className={styles.accountReference} data-testid="account-id">{account.account_id}</dd></div>
            <div><dt>{copy.portal.access}</dt><dd>{account.roles.map((role) => copy.portal.roleLabels[role] || role).join(', ')}</dd></div>
            <div><dt>{copy.portal.locale}</dt><dd>{account.locale}</dd></div>
            <div><dt>{copy.portal.verified}</dt><dd className={styles.status}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="m7.5 12 3 3 6-6" /></svg>{copy.portal.verified}</dd></div>
          </dl>
        </section>
        {kind === 'learn' && <section id="learners" className={styles.section} aria-labelledby="learners-heading">
          <h2 id="learners-heading">{copy.portal.learnerTitle}</h2>
          <p>{copy.portal.learnerDescription}</p>
          {account.authorized_learner_ids.length ? <ul className={styles.learnerList}>{account.authorized_learner_ids.map((id) => <li key={id}><span>{copy.portal.learnerReference}</span><strong data-testid="learner-id">{id}</strong></li>)}</ul> : <p>{copy.portal.noLearners}</p>}
        </section>}
        {children}
        <section className={styles.section} aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading">{copy.portal.upcomingTitle}</h2>
          <ul className={styles.futureList}>{text.future.map((item, index) => <li key={item.name}><button disabled aria-describedby={`prerequisite-${index}`}>{item.name}</button><p id={`prerequisite-${index}`}>{item.reason}</p></li>)}</ul>
        </section>
      </main>
    </div>
  </div>;
}
