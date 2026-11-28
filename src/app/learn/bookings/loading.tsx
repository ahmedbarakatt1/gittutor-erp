import { bookingCopy } from '@/locales/booking';
import { bookingCopy as arabicCopy } from '@/locales/ar-transaction/booking';
import { getSiteLanguage } from '@/server/site-language';

export default async function LoadingBookings() {
  const copy = await getSiteLanguage() === 'ar' ? arabicCopy : bookingCopy;
  return <main className="container section-spacing"><p role="status">{copy.loading}</p></main>;
}
