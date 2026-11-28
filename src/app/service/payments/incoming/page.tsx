import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { StaffFunds } from '@/components/payments/staff-transfers';
import { paymentCopy as copy } from '@/locales/payments';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};

export const generateMetadata = pageMetadata({ title: 'Incoming transfers | Git Tutor', robots: { index: false, follow: false } });
export default async function PaymentWorkspacePage() {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const account = await requireAccount('customer_service'); return <PortalShell kind="service" account={account} title={copy.serviceTitle} description={copy.serviceDescription} activePath="/service/payments" showAccount={false}><StaffFunds /></PortalShell>; }
