import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { EnrollmentTransferConsentDetail } from '@/components/payments/enrollment-transfer-consents';
import { transferCopy as copy } from '@/locales/enrollment-transfers';
import { transferCopy as arabicTransferCopy } from '@/locales/ar-transaction/enrollment-transfers';
import { getSiteLanguage } from '@/server/site-language';


const textByLanguage = {
  en: { copy },
  ar: { copy: arabicTransferCopy },
};
export const generateMetadata = pageMetadata({ title: 'Authorize original funds | Git Tutor', robots: { index: false, follow: false } });
export default async function TransferConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const { id } = await params; return <PortalShell kind="learn" account={await requireAccount(undefined, `/learn/payments/enrollment-transfer-consents/${id}`)} title={copy.payerTitle} description={copy.payerDescription} activePath="/learn/payments" showAccount={false}><EnrollmentTransferConsentDetail id={id} /></PortalShell>; }
