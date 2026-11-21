import type { SiteLanguage } from './language';
import arabic from './ar-staff-messages.json';

const labels: Readonly<Record<string, string>> = arabic;

/** Translate a UI label supplied by the application. User-entered values are rendered separately. */
export function staffText(language: SiteLanguage, label: string): string {
  if (language === 'en') return label;
  const key = label.trim();
  if (!Object.hasOwn(labels, key)) return label;
  return label.replace(key, () => labels[key]);
}
/** These dictionaries contain authored UI copy, including nested role/status labels. */
const translatedPacks = new WeakMap<object, object>();
export function arabicStaffPack<T extends object>(pack: T): T {
  const cached = translatedPacks.get(pack);
  if (cached) return cached as T;
  const translate = (value: unknown): unknown => {
    if (typeof value === 'string') return staffText('ar', value);
    if (Array.isArray(value)) return value.map(translate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translate(item)]));
    return value;
  };
  const result = translate(pack) as T;
  translatedPacks.set(pack, result);
  return result;
}
