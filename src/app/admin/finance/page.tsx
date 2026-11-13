import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { FinanceWorkspace } from '@/components/teaching/finance-workspace';
import { financeCopy as copy } from '@/locales/finance';
export const metadata: Metadata = { title: 'Finance | Git Tutor', robots: { index: false, follow: false } };
export default async function FinancePage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.title} description={copy.intro} activePath="/admin/finance" showAccount={false}><FinanceWorkspace /></PortalShell>; }
