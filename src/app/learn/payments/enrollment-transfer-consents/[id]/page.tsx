import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { EnrollmentTransferConsentDetail } from '@/components/payments/enrollment-transfer-consents';
import { transferCopy as copy } from '@/locales/enrollment-transfers';
export const metadata: Metadata = { title: 'Authorize original funds | Git Tutor', robots: { index: false, follow: false } };
export default async function TransferConsentPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/enrollment-transfer-consents/${id}`)} title={copy.payerTitle} description={copy.payerDescription} activePath="/learn/payments" showAccount={false}><EnrollmentTransferConsentDetail id={id} /></PortalShell>; }
