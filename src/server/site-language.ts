import 'server-only';
import { cookies } from 'next/headers';
import { isSiteLanguage, languageCookie, type SiteLanguage } from '@/locales/language';

export async function getSiteLanguage(): Promise<SiteLanguage> {
  const value = (await cookies()).get(languageCookie)?.value;
  return isSiteLanguage(value) ? value : 'en';
}
