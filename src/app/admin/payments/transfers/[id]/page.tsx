import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { StaffTransferDetail } from '@/components/payments/staff-transfers';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Incoming transfer | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.adminTitle} description={copy.adminDescription} activePath="/admin/payments" showAccount={false}><StaffTransferDetail id={id} admin /></PortalShell>; }
