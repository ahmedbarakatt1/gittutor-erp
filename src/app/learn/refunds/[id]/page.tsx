import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RefundDetail } from '@/components/payments/refunds';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Refund | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const account = await requireAccount(undefined, `/learn/refunds/${id}`); return <PortalShell kind="learn" account={account} title={copy.refundTitle} description={copy.refundDescription} activePath="/learn/refunds" showAccount={false}><RefundDetail id={id} /></PortalShell>; }
