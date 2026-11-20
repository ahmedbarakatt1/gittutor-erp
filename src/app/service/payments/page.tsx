import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { ReviewQueue } from '@/components/payments/staff-review';
import { paymentCopy as copy } from '@/locales/payments';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Payment reviews | Git Tutor', robots: { index: false, follow: false } };
export default async function PaymentWorkspacePage() { const account = await requireAccount('customer_service'); return <PortalShell kind="service" account={account} title={copy.serviceTitle} description={copy.serviceDescription} activePath="/service/payments" showAccount={false}><WorkflowOperationsWorkspace workspace="service" view="payments"><ReviewQueue actorId={account.account_id} /></WorkflowOperationsWorkspace></PortalShell>; }
