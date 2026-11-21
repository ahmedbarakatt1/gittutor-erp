import { expect, test } from 'vitest';
import { catalogCopy as arCatalog } from '../../src/locales/ar-transaction/catalog';
import { meetingCopy as arMeetings } from '../../src/locales/ar-transaction/meetings';
import { formatMinorUnits } from '../../src/modules/shared/format';
import { groupTuition } from '../../src/modules/catalog/public-tuition';

const domains = [
  'booking', 'booking-staff', 'catalog', 'catalog-policy', 'enrollment-transfers',
  'files', 'finance', 'group-changes', 'meetings', 'packages', 'payments', 'payroll', 'quizzes',
];

function numbers(text: string) {
  const normalized = text.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return (normalized.match(/\d+/g) ?? []).sort();
}

function compareCopy(english: unknown, arabic: unknown, path: string) {
  expect(typeof arabic, path).toBe(typeof english);
  if (typeof english === 'function' && typeof arabic === 'function') {
    expect(arabic.length, path).toBe(english.length);
    const values = Array.from({ length: english.length }, (_, i) => 37 + 11 * i);
    const translated = String(arabic(...values));
    expect(translated, path).toMatch(/\p{Script=Arabic}/u);
    expect(numbers(translated), path).toEqual(numbers(String(english(...values))));
  } else if (english !== null && typeof english === 'object') {
    const source = english as Record<string, unknown>;
    const translation = arabic as Record<string, unknown>;
    expect(Object.keys(translation).sort(), path).toEqual(Object.keys(source).sort());
    for (const key of Object.keys(source)) compareCopy(source[key], translation[key], path + '.' + key);
  } else if (typeof english === 'string') {
    expect(arabic, path).not.toBe('');
  }
}

test.each(domains)('Arabic %s retains all fields, states and formatter arguments', async domain => {
  const original = await import(`../../src/locales/${domain}.ts`);
  const translated = await import(`../../src/locales/ar-transaction/${domain}.ts`);
  for (const key of Object.keys(original)) compareCopy(original[key], translated[key], domain + '.' + key);
});

test('Arabic terms preserve the currency, refund boundaries and original subject name', () => {
  const terms = arCatalog.termsText;
  expect(terms.window(17, 73, 25)).toContain('تقلّ عن ٧٣ دقيقة');
  expect(terms.window(17, null, 25)).toContain('١٧ دقيقة أو أكثر');
  expect(terms.window(17, null, 25)).toContain('٢٥٪');
  expect(terms.packageExpiry(null)).toContain('بلا تاريخ انتهاء');
  const amount = formatMinorUnits(57525, 'EGP', 'ar-EG');
  expect(terms.packageSessions('٢٫٥', 95, amount)).toContain(amount);
  for (const tier of groupTuition) {
    expect(arCatalog.admin.groupPricing).toContain(formatMinorUnits(tier.price_minor, 'EGP', 'ar-EG', true));
  }
  expect(arCatalog.subjectAsk('Applied Statistics (ST101)')).toContain('Applied Statistics (ST101)');
  expect(numbers(arMeetings.countdown(0, 15, 28))).toEqual(['15', '28']);
});
