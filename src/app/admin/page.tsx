import { RequestEntry } from '@/components/requests/entry';
import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import Link from 'next/link';
import styles from '@/components/workflow-import/operational-workspaces.module.css';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
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
  const operations = await getWorkflowOperations(await serverSupabase());
  if (!operations.enabled) return <PortalShell kind="admin" account={account}><RequestEntry staff="admin" /><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>;
  const overview = operations.sections.find(section => section.key === 'overview');
  const initialData = {
    enabled: operations.enabled, role: operations.role, sections: overview ? [overview] : [],
    mapping_options: overview?.records.some(row => row.review.can_review) ? operations.mapping_options : { learners: [], tutors: [] },
  } satisfies typeof operations;
  return <PortalShell kind="admin" account={account} title="Your business overview" description="Payments and completions are reported by the workbook. Select a chart value to see its source records." showAccount={false} activePath="/admin">
    <OperationalWorkspace view="overview" initialData={initialData} overviewAction={<Link href="/admin/requests">Open request queue</Link>} />
    <nav className={styles.dailyOperations} aria-labelledby="daily-operations-title">
      <h2 id="daily-operations-title">Daily operations</h2>
      <ul>{dailyOperations.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
    </nav>
  </PortalShell>;
}
