import { RequestEntry } from '@/components/requests/entry';
import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { loadStaffOverview } from '@/components/workflow-import/staff-overview';
import Link from 'next/link';
import styles from '@/components/workflow-import/operational-workspaces.module.css';
import { StaffAccessWorkspace, TutorApplicationReview } from '@/components/identity-workspaces';

export const metadata: Metadata = { title: 'Administration | Git Tutor', robots: { index: false, follow: false } };
const dailyOperations = [
  ['/admin/schedule', 'Schedule lessons'],
  ['/admin/customers', 'Your students'],
  ['/admin/payments', 'Review payments'],
  ['/admin/finance', 'Financial overview'],
  ['/admin/packages', 'Manage packages'],
  ['/admin/access', 'Staff and applications'],
] as const;

export default async function AdminPage() {
  const account = await requireAccount('admin');
  const { overview } = await loadStaffOverview('admin');
  if (!overview) return <PortalShell kind="admin" account={account} primaryAction={<RequestEntry staff="admin" />}><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>;
  return <PortalShell kind="admin" account={account} title="Your business overview" description="Session, package and headcount figures from the workbook." showAccount={false} activePath="/admin">
    {overview}
    <nav className={styles.dailyOperations} aria-labelledby="daily-operations-title">
      <h2 id="daily-operations-title">Daily operations</h2>
      <ul>{dailyOperations.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
    </nav>
  </PortalShell>;
}
