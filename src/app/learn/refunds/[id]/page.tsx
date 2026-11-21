import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RefundDetail } from '@/components/payments/refunds';
import { paymentCopy as copy } from '@/locales/payments';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};

export const generateMetadata = pageMetadata({ title: 'Refund | Git Tutor', robots: { index: false, follow: false } });
export default async function PaymentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const { id } = await params; const account = await requireAccount(undefined, `/learn/refunds/${id}`); return <PortalShell kind="learn" account={account} title={copy.refundTitle} description={copy.refundDescription} activePath="/learn/refunds" showAccount={false}><RefundDetail id={id} /></PortalShell>; }
