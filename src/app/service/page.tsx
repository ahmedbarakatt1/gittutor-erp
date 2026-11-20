import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { loadStaffOverview } from '@/components/workflow-import/staff-overview';
import styles from '@/components/workflow-import/operational-workspaces.module.css';

export const metadata: Metadata = { title: 'Customer service | Git Tutor', robots: { index: false, follow: false } };
export default async function ServicePage() {
  const account = await requireAccount('customer_service');
  const { overview, queueAction } = await loadStaffOverview('service');
  if (!overview) return <PortalShell kind="service" account={account} primaryAction={<div className={styles.overviewToolbar}>{queueAction}</div>} />;
  return <PortalShell kind="service" account={account} title="Your customer overview" description="Session, package and learner figures from the workbook." showAccount={false} activePath="/service">
    {overview}
  </PortalShell>;
}
