import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { ChargeInstructions } from '@/components/payments/customer-payments';
import { paymentCopy as copy } from '@/locales/payments';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';


const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};
export const generateMetadata = pageMetadata({ title: 'Payment instructions | Git Tutor', robots: { index: false, follow: false } });
export default async function ChargePage({ params }: { params: Promise<{ id: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/charges/${id}`)} title={copy.instructionsTitle} description={copy.reportDescription} activePath="/learn/payments" showAccount={false}><ChargeInstructions id={id} /></PortalShell>; }
