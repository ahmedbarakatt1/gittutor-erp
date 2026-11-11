import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { PayerTransferDetail } from '@/components/payments/customer-payments';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Your transfer | Git Tutor', robots: { index: false, follow: false } };
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/transfers/${id}`)} title={copy.ownMoney} description={copy.ownMoneyDescription} activePath="/learn/payments" showAccount={false}><PayerTransferDetail id={id} /></PortalShell>; }
