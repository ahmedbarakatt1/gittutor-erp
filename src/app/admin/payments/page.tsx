import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { StaffFunds } from '@/components/payments/staff-transfers';
import { paymentCopy as copy } from '@/locales/payments';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};

export const generateMetadata = pageMetadata({ title: 'Receiving accounts and funds | Git Tutor', robots: { index: false, follow: false } });
export default async function PaymentWorkspacePage() {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.adminTitle} description={copy.adminDescription} activePath="/admin/payments" showAccount={false}><WorkflowOperationsWorkspace workspace="admin" view="payments"><StaffFunds admin /></WorkflowOperationsWorkspace></PortalShell>; }
