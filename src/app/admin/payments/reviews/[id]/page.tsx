import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { ReviewCase } from '@/components/payments/staff-review';
import { paymentCopy as copy } from '@/locales/payments';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};

export const generateMetadata = pageMetadata({ title: 'Payment comparison | Git Tutor', robots: { index: false, follow: false } });
export default async function PaymentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const { id } = await params; const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.serviceTitle} description={copy.serviceDescription} activePath="/admin/payments" showAccount={false}><ReviewCase id={id} actorId={account.account_id} admin /></PortalShell>; }
