import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import Link from 'next/link';
import styles from '@/components/auth.module.css';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
import { StaffAccessWorkspace, TutorApplicationReview } from '@/components/identity-workspaces';

export const metadata: Metadata = { title: 'Administration | Git Tutor', robots: { index: false, follow: false } };
export default async function AdminPage() {
  const account = await requireAccount('admin');
  const operations = await getWorkflowOperations(await serverSupabase());
  if (!operations.enabled) return <PortalShell kind="admin" account={account}><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>;
  return <PortalShell kind="admin" account={account} title="Your business overview" description="Manage students, lessons and payments from one workspace." showAccount={false} activePath="/admin">
    <OperationalWorkspace view="overview" />
    <section className={styles.section} aria-label="Daily operations">
      <h2>Keep things moving</h2>
      <ul className={styles.recordGrid}>
        <li><h3><Link href="/admin/schedule">Schedule lessons</Link></h3><p>Review your timetable and arrange the next session.</p></li>
        <li><h3><Link href="/admin/customers">Your students</Link></h3><p>Open a student record, review history and plan a follow-up.</p></li>
        <li><h3><Link href="/admin/payments">Review payments</Link></h3><p>Match submitted receipts with independently checked transfers.</p></li>
        <li><h3><Link href="/admin/finance">Financial overview</Link></h3><p>See reported balances alongside newly recorded activity.</p></li>
        <li><h3><Link href="/admin/packages">Manage packages</Link></h3><p>Review existing packages and arrange new purchases.</p></li>
        <li><h3><Link href="/admin/access">Staff and applications</Link></h3><p>Manage team access and review teaching applications.</p></li>
      </ul>
    </section>
  </PortalShell>;
}
