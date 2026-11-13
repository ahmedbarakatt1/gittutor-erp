import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { FinanceWorkspace } from '@/components/teaching/finance-workspace';
import { financeCopy as copy } from '@/locales/finance';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Finance | Git Tutor', robots: { index: false, follow: false } };
export default async function FinancePage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.title} description={copy.intro} activePath="/admin/finance" showAccount={false}><WorkflowOperationsWorkspace view="finance"><FinanceWorkspace /></WorkflowOperationsWorkspace></PortalShell>; }
