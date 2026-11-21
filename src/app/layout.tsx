import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import { homeMessages } from '@/locales/ar-public';
import { getSiteLanguage } from '@/server/site-language';
import { SiteLanguageProvider } from '@/components/site-language';

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = homeMessages(await getSiteLanguage());
  return {
    ...metadata,
    icons: { icon: '/brand/git-tutor-instagram.jpg', apple: '/brand/git-tutor-instagram.jpg' },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = await getSiteLanguage();
  return (
    <html lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} data-scroll-behavior="smooth">
      <body><SiteLanguageProvider language={language}>
        {children}
      </SiteLanguageProvider></body>
    </html>
  );
}
