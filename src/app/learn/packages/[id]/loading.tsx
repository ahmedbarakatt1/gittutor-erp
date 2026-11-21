import { packageCopy } from '@/locales/packages';
import { packageCopy as arabicCopy } from '@/locales/ar-transaction/packages';
import { getSiteLanguage } from '@/server/site-language';

export default async function LoadingPackage() {
  const copy = await getSiteLanguage() === 'ar' ? arabicCopy : packageCopy;
  return <main className="container section-spacing"><p role="status">{copy.loading}</p></main>;
}
