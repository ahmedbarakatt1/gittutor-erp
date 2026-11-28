import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerPayments } from '@/components/payments/customer-payments';
import { paymentCopy as copy } from '@/locales/payments';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';
import { StaffMessage } from '@/components/ar-staff-label';
import { authCopy } from '@/locales/auth';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};

export const generateMetadata = pageMetadata({ title: 'Payments | Git Tutor', robots: { index: false, follow: false } });
export default async function PaymentsPage() {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const account = await requireAccount(undefined, '/learn/payments');
  const hasLearnerAccess = account.roles.some(role => role === 'student' || role === 'guardian');
  return <PortalShell kind="learn" account={account} title={copy.customerTitle} description={copy.customerDescription} activePath="/learn/payments" showAccount={false}>
    {account.roles.length === 0 && account.authorized_learner_ids.length === 0 && <p><StaffMessage text={authCopy.portal.noLearners} /></p>}
    {hasLearnerAccess
      ? <WorkflowOperationsWorkspace workspace="learn" view="payments"><CustomerPayments /></WorkflowOperationsWorkspace>
      : <CustomerPayments />}
  </PortalShell>;
}
