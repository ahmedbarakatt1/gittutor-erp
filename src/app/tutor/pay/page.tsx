import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { PayrollWorkspace } from '@/components/teaching/payroll-workspace';
import { payrollCopy as copy } from '@/locales/payroll';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Tutor pay | Git Tutor', robots: { index: false, follow: false } };
export default async function PayPage() { const account = await requireAccount('tutor'); return <PortalShell kind="tutor" account={account} title={copy.title} description={copy.intro} activePath="/tutor/pay" showAccount={false}><WorkflowOperationsWorkspace workspace="tutor" view="tutor_pay"><PayrollWorkspace /></WorkflowOperationsWorkspace></PortalShell>; }
