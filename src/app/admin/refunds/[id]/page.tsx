import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RefundDetail } from '@/components/payments/refunds';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Refund review | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.adminRefundTitle} description={copy.adminRefundDescription} activePath="/admin/refunds" showAccount={false}><RefundDetail id={id} admin /></PortalShell>; }
