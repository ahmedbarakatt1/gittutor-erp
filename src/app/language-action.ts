'use server';

import { cookies } from 'next/headers';
import { isSiteLanguage, languageCookie } from '@/locales/language';

export async function changeSiteLanguage(form: FormData): Promise<void> {
  const language = form.get('language');
  if (!isSiteLanguage(language)) return;
  (await cookies()).set(languageCookie, language, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.APP_BASE_URL?.startsWith('https://') ?? false,
  });
}
