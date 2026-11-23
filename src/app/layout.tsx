import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import { homeMessages } from '@/locales/ar-public';
import { getSiteLanguage } from '@/server/site-language';
import { SiteLanguageProvider } from '@/components/site-language';
import { headers } from 'next/headers';
import { SessionGuard } from '@/components/session-guard';

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = homeMessages(await getSiteLanguage());
  return {
    ...metadata,
    icons: { icon: '/brand/git-tutor-instagram.jpg', apple: '/brand/git-tutor-instagram.jpg' },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = await getSiteLanguage();
  const view = (await headers()).get('x-git-tutor-rendered-view') || 'signed-out';
  return (
    <html lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} data-scroll-behavior="smooth" data-session-view={view}>
      <body><SiteLanguageProvider language={language}>
        <SessionGuard />
        {children}
      </SiteLanguageProvider></body>
    </html>
  );
}
