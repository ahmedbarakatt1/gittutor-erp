import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import { en } from '@/locales/en';

export const metadata: Metadata = {
  title: en.metadata.title,
  description: en.metadata.description,
  icons: { icon: '/brand/git-tutor-instagram.jpg', apple: '/brand/git-tutor-instagram.jpg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir={en.direction} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
