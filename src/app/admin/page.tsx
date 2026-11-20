import { RequestEntry } from '@/components/requests/entry';
import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import Link from 'next/link';
import styles from '@/components/workflow-import/operational-workspaces.module.css';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { listRequestQueue } from '@/modules/requests/queries';
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
  const client = await serverSupabase();
  const [operations, queue] = await Promise.all([
    getWorkflowOperations(client),
    listRequestQueue(client, { limit: 1 }).catch(() => null),
  ]);
  if (!operations.enabled) return <PortalShell kind="admin" account={account} primaryAction={<RequestEntry staff="admin" />}><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>;
  const overview = operations.sections.find(section => section.key === 'overview');
  const initialData = {
    enabled: operations.enabled, role: operations.role, sections: overview ? [overview] : [],
    mapping_options: overview?.records.some(row => row.review.can_review) ? operations.mapping_options : { learners: [], tutors: [] },
  } satisfies typeof operations;
  const firstRequest = queue?.items[0];
  const queueHint = firstRequest ? `First in queue · ${firstRequest.topic}`
    : queue ? 'No requests in the queue' : 'Queue preview unavailable';
  return <PortalShell kind="admin" account={account} title="Your business overview" description="Session, package and headcount figures from the workbook." showAccount={false} activePath="/admin">
    <OperationalWorkspace view="overview" initialData={initialData} overviewAction={
      <Link className={styles.queueAction} href="/admin/requests" aria-label="Open request queue" aria-describedby="queue-preview">
        <span>Open request queue</span><small id="queue-preview">{queueHint}</small>
      </Link>
    } />
    <nav className={styles.dailyOperations} aria-labelledby="daily-operations-title">
      <h2 id="daily-operations-title">Daily operations</h2>
      <ul>{dailyOperations.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
    </nav>
  </PortalShell>;
}
