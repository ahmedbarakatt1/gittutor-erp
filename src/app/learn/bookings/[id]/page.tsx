import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerBookingDetail } from '@/components/booking/customer-bookings';
import { bookingCopy as copy } from '@/locales/booking';

export const metadata: Metadata = { title: 'Your reservation | Git Tutor', robots: { index: false, follow: false } };
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount('student'); const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <PortalShell kind="learn" account={account} title={copy.detail} description={copy.allTimes} activePath="/learn/bookings" showAccount={false}><CustomerBookingDetail enrollmentId={id} /></PortalShell>;
}
