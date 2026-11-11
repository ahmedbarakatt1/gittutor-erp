import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { StaffFunds } from '@/components/payments/staff-transfers';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Incoming transfers | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage() { const account = await requireAccount('customer_service'); return <PortalShell kind="service" account={account} title={copy.serviceTitle} description={copy.serviceDescription} activePath="/service/payments" showAccount={false}><StaffFunds /></PortalShell>; }
