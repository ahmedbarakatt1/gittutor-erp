import { pageMetadata } from '@/server/page-metadata';
import { notFound } from 'next/navigation';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerBookingDetail } from '@/components/booking/customer-bookings';
import { bookingCopy as copy } from '@/locales/booking';
import { bookingCopy as arabicBookingCopy } from '@/locales/ar-transaction/booking';
import { getSiteLanguage } from '@/server/site-language';


const textByLanguage = {
  en: { copy },
  ar: { copy: arabicBookingCopy },
};

export const generateMetadata = pageMetadata({ title: 'Your reservation | Git Tutor', robots: { index: false, follow: false } });
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const account = await requireAccount('student'); const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <PortalShell kind="learn" account={account} title={copy.detail} description={copy.allTimes} activePath="/learn/bookings" showAccount={false}><CustomerBookingDetail enrollmentId={id} /></PortalShell>;
}
