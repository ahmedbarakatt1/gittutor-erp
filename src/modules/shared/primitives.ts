declare const moneyBrand: unique symbol;
declare const uuidBrand: unique symbol;
declare const versionBrand: unique symbol;
export type MoneyMinor = number & { readonly [moneyBrand]: true };
export type UUID = string & { readonly [uuidBrand]: true };
export type Version = number & { readonly [versionBrand]: true };

export function moneyMinor(value: number): MoneyMinor {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("AMOUNT_OUT_OF_RANGE");
  return value as MoneyMinor;
}
export function version(value: number): Version {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("VALIDATION_ERROR");
  return value as Version;
}
export function uuid(value: string): UUID {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("VALIDATION_ERROR");
  return value as UUID;
}
export function cairoDate(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_TIME");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function formatMoney(value: number, locale = "en-EG"): string {
  moneyMinor(value);
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(value / 100);
}
