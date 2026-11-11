import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerPayments } from '@/components/payments/customer-payments';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Payments | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentsPage() { return <PortalShell kind="learn" account={await requireAccount(undefined, '/learn/payments')} title={copy.customerTitle} description={copy.customerDescription} activePath="/learn/payments" showAccount={false}><CustomerPayments /></PortalShell>; }
