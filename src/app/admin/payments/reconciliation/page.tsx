import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { FinancialExceptions } from '@/components/payments/reconciliation';
import { paymentCopy as copy } from '@/locales/payments';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};

export const generateMetadata = pageMetadata({ title: 'Financial exceptions | Git Tutor', robots: { index: false, follow: false } });
export default async function PaymentWorkspacePage() {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.reconciliationTitle} description={copy.reconciliationDescription} activePath="/admin/payments" showAccount={false}><FinancialExceptions /></PortalShell>; }
