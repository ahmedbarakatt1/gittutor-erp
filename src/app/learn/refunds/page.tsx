import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { Refunds } from '@/components/payments/refunds';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Refunds | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage() { const account = await requireAccount(undefined, `/learn/refunds`); return <PortalShell kind="learn" account={account} title={copy.refundTitle} description={copy.refundDescription} activePath="/learn/refunds" showAccount={false}><Refunds /></PortalShell>; }
