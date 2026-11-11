import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { PayerPlanDetail } from '@/components/payments/customer-payments';
import { paymentCopy as copy } from '@/locales/payments';
export const metadata: Metadata = { title: 'Confirm payment use | Git Tutor', robots: { index: false, follow: false } };
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/plans/${id}`)} title={copy.planReviewTitle} description={copy.planReviewDescription} activePath="/learn/payments" showAccount={false}><PayerPlanDetail id={id} /></PortalShell>; }
