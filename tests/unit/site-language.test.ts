import { beforeEach, expect, test, vi } from 'vitest';
import { getSiteLanguage } from '@/server/site-language';
import { changeSiteLanguage } from '@/app/language-action';
import { languageCookie } from '@/locales/language';

const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => jar }));
beforeEach(() => { vi.resetAllMocks(); });

test('a visitor starts in English and only a supported explicit preference changes the language', async () => {
  expect(await getSiteLanguage()).toBe('en');
  jar.get.mockReturnValue({ value: 'ar' });
  expect(await getSiteLanguage()).toBe('ar');
  expect(jar.get).toHaveBeenCalledWith(languageCookie);
  jar.get.mockReturnValue({ value: 'invalid' });
  expect(await getSiteLanguage()).toBe('en');
});

test('the language control stores a site-wide preference and ignores unsupported values', async () => {
  const form = new FormData();
  form.set('language', 'ar');
  await changeSiteLanguage(form);
  expect(jar.set).toHaveBeenCalledWith(languageCookie, 'ar', expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' }));
  form.set('language', 'en');
  await changeSiteLanguage(form);
  form.set('language', 'xx');
  await changeSiteLanguage(form);
  expect(jar.set).toHaveBeenCalledTimes(2);
});
