import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { PayrollWorkspace } from '@/components/teaching/payroll-workspace';
import { payrollCopy as copy } from '@/locales/payroll';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Tutor pay | Git Tutor', robots: { index: false, follow: false } };
export default async function PayPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.adminTitle} description={copy.intro} activePath="/admin/pay" showAccount={false}><WorkflowOperationsWorkspace view="tutor_pay"><PayrollWorkspace admin /></WorkflowOperationsWorkspace></PortalShell>; }
