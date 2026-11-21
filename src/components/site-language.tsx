'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { changeSiteLanguage } from '@/app/language-action';
import type { SiteLanguage } from '@/locales/language';

const SiteLanguageContext = createContext<SiteLanguage>('en');

export function SiteLanguageProvider({ language, children }: { language: SiteLanguage; children: ReactNode }) {
  return <SiteLanguageContext.Provider value={language}>{children}</SiteLanguageContext.Provider>;
}

export function useSiteLanguage(): SiteLanguage {
  return useContext(SiteLanguageContext);
}

function SwitchButton() {
  const target = useSiteLanguage() === 'en' ? 'ar' : 'en';
  const { pending } = useFormStatus();
  return <button type="submit" name="language" value={target} lang={target}
    dir={target === 'ar' ? 'rtl' : 'ltr'} disabled={pending}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" />
    </svg>
    {target === 'ar' ? 'العربية' : 'English'}
  </button>;
}

export function LanguageSwitch() {
  return <div className="language-bar"><form className="container" action={changeSiteLanguage}>
    <SwitchButton />
  </form></div>;
}
