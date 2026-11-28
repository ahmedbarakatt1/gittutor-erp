'use client';

import Link from 'next/link';
import { BrandLogo } from './brand-logo';
import { useSiteLanguage } from './site-language';
import { arabicStaffPack, staffText } from '@/locales/ar-staff';

const arabicText = (value: string) => staffText('ar', value);
const englishText = (value: string) => value;

export function useStaffText() {
  return useSiteLanguage() === 'ar' ? arabicText : englishText;
}

export function useStaffCopy<T extends object>(pack: T): T {
  return useSiteLanguage() === 'ar' ? arabicStaffPack(pack) : pack;
}

export function StaffMessage({ text }: { text: string }) {
  return useStaffText()(text);
}

export function StaffCairoLessonTime({ instant }: { instant: string }) {
  const language = useSiteLanguage();
  const formatter = new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo',
  });
  return <time dateTime={instant}>{formatter.format(new Date(instant))} {staffText(language, 'Cairo')}</time>;
}

export function PortalHomeLink({ className, href, label }: { className: string; href: string; label: string }) {
  const t = useStaffText();
  return <Link className={className} href={href} aria-label={t(label)}><BrandLogo compact /></Link>;
}

export function SiteLanguageName() {
  return useSiteLanguage() === 'ar' ? 'العربية' : 'English';
}
