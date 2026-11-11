import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { ChargeInstructions } from '@/components/payments/customer-payments';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Payment instructions | Git Tutor', robots: { index: false, follow: false } };
export default async function ChargePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/charges/${id}`)} title={copy.instructionsTitle} description={copy.reportDescription} activePath="/learn/payments" showAccount={false}><ChargeInstructions id={id} /></PortalShell>; }
