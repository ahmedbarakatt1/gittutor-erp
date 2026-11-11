import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import { en } from '@/locales/en';

export const metadata: Metadata = {
  title: en.metadata.title,
  description: en.metadata.description,
  icons: { icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"%3E%3Crect width="48" height="48" rx="8" fill="%23cf302f"/%3E%3Ctext x="24" y="35" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="34" fill="white"%3EG%3C/text%3E%3C/svg%3E' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir={en.direction}>
      <body>{children}</body>
    </html>
  );
}
