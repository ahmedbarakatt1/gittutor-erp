export type SiteLanguage = 'en' | 'ar';

export const languageCookie = 'git_tutor_language';

export function isSiteLanguage(value: unknown): value is SiteLanguage {
  return value === 'en' || value === 'ar';
}
