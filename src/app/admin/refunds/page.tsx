import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { Refunds } from '@/components/payments/refunds';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Refund review | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.adminRefundTitle} description={copy.adminRefundDescription} activePath="/admin/refunds" showAccount={false}><Refunds admin /></PortalShell>; }
