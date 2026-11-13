import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { WorkflowWorkspace } from '@/components/workflow-import/workspace';

export const metadata: Metadata = { title: 'Actual records | Git Tutor', robots: { index: false, follow: false } };
export default async function WorkflowPage() {
  const account = await requireAccount('admin');
  return <PortalShell kind="admin" account={account} activePath="/admin/workflow" title="Your actual records" description="Sessions, people and balances from your workflow workbook." showAccount={false}><WorkflowWorkspace /></PortalShell>;
}
