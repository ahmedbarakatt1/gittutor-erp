import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { ReceiptDetail } from '@/components/payments/receipt-detail';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Receipt review | Git Tutor', robots: { index: false, follow: false } };
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/${id}`)} title={copy.openReceipt} description={copy.reportDescription} activePath="/learn/payments" showAccount={false}><ReceiptDetail id={id} /></PortalShell>; }
