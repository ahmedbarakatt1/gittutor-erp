import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { FinancialExceptions } from '@/components/payments/reconciliation';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Financial exceptions | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.reconciliationTitle} description={copy.reconciliationDescription} activePath="/admin/payments" showAccount={false}><FinancialExceptions /></PortalShell>; }
