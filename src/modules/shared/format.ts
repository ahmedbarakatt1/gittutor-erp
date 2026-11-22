import type { SiteLanguage } from '@/locales/language';

/** Format scaled integer units without rounding a large monetary/entitlement value through division. */
function formatScaled(value: number|string, scaleDigits: number, locale: string, options: Intl.NumberFormatOptions, trimFraction: boolean) {
  if (typeof value==='number'?!Number.isSafeInteger(value):! /^-?(?:0|[1-9]\d{0,99})$/.test(value)) throw new Error('SAFE_INTEGER_REQUIRED');
  const exact = BigInt(value);
  const scale = 10n ** BigInt(scaleDigits);
  const whole = exact / scale;
  const magnitude = exact < 0n ? -exact : exact;
  let fraction = (magnitude % scale).toString().padStart(scaleDigits, '0');
  if (trimFraction) fraction = fraction.replace(/0+$/, '');
  const formatter = new Intl.NumberFormat(locale, { ...options, minimumFractionDigits: fraction.length, maximumFractionDigits: fraction.length });
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const localizedFraction = [...fraction].map(digit => digitFormatter.format(Number(digit))).join('');
  // BigInt has no negative zero, but -0 keeps the correct localized sign for -0.01 or -0.001.
  const integer = exact < 0n && whole === 0n ? -0 : whole;
  return formatter.formatToParts(integer).map(part => part.type === 'fraction' ? localizedFraction : part.value).join('');
}

export function formatMinorUnits(value: number, currency = 'EGP', locale = 'en-EG', trimWhole = false) {
  return formatScaled(value, 2, locale, { style: 'currency', currency }, trimWhole && value % 100 === 0);
}

/** Reports can aggregate more than one safe-sized posting; keep all integer digits. */
export function formatFinanceAmount(value:number|string,locale='en-EG') {
  return formatScaled(value,2,locale,{style:'currency',currency:'EGP'},false);
}

export function formatCreditQuanta(value: number, locale = 'en-EG') {
  return formatScaled(value, 3, locale, {}, true);
}

/** A locale-independent decimal string suitable for numeric input values and bounds. */
export function scaledIntegerInput(value: number, scaleDigits: 2 | 3) {
  if (!Number.isSafeInteger(value)) throw new Error('SAFE_INTEGER_REQUIRED');
  if (scaleDigits !== 2 && scaleDigits !== 3) throw new Error('UNIT_SCALE_REQUIRED');
  const exact = BigInt(value), magnitude = exact < 0n ? -exact : exact, scale = 10n ** BigInt(scaleDigits);
  const fraction = (magnitude % scale).toString().padStart(scaleDigits, '0').replace(/0+$/, '');
  return `${exact < 0n ? '-' : ''}${magnitude / scale}${fraction ? `.${fraction}` : ''}`;
}

/** Parse an unsigned plain decimal directly into integer units without floating-point scaling. */
export function decimalInputPattern(scaleDigits: 2 | 3) {
  return `[0-9٠-٩۰-۹]+(?:[.٫][0-9٠-٩۰-۹]{1,${scaleDigits}})?`;
}

export function parseScaledIntegerInput(raw: string, scaleDigits: 2 | 3) {
  if (scaleDigits !== 2 && scaleDigits !== 3) throw new Error('UNIT_SCALE_REQUIRED');
  if (raw.length > 32 || !new RegExp(`^${decimalInputPattern(scaleDigits)}$`, 'u').test(raw)) throw new Error('DECIMAL_INPUT_REQUIRED');
  const normalized = raw.replace(/[٠-٩۰-۹]/gu, digit => String(digit.charCodeAt(0) & 15)).replace('٫', '.');
  const [whole, fraction = ''] = normalized.split('.');
  const exact = BigInt(whole) * (10n ** BigInt(scaleDigits)) + BigInt(fraction.padEnd(scaleDigits, '0'));
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('DECIMAL_INPUT_REQUIRED');
  return Number(exact);
}

export const formatTuition = (minor: number, currency = 'EGP', language: SiteLanguage = 'en') => formatMinorUnits(minor, currency, language === 'ar' ? 'ar-EG' : 'en-EG', true);
