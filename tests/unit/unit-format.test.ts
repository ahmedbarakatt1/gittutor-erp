import { expect, test } from 'vitest';
import { formatCreditQuanta, formatMinorUnits, parseScaledIntegerInput, scaledIntegerInput } from '../../src/modules/shared/format';

const text = (value: string) => value.replace(/\s/g, ' ');
test('minor-unit display preserves exact cents across the full allowed integer range', () => {
  expect(text(formatMinorUnits(Number.MAX_SAFE_INTEGER))).toBe('EGP 90,071,992,547,409.91');
  expect(text(formatMinorUnits(-Number.MAX_SAFE_INTEGER))).toBe('-EGP 90,071,992,547,409.91');
  expect(text(formatMinorUnits(-50))).toBe('-EGP 0.50');
  expect(text(formatMinorUnits(57500))).toBe('EGP 575.00');
  expect(text(formatMinorUnits(57500, 'EGP', 'en-EG', true))).toBe('EGP 575');
  expect(text(formatMinorUnits(57501, 'EGP', 'en-EG', true))).toBe('EGP 575.01');
});

test('credit display preserves every quantum and trims only insignificant decimal zeros', () => {
  expect(formatCreditQuanta(Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740.991');
  expect(formatCreditQuanta(1000)).toBe('1');
  expect(formatCreditQuanta(500)).toBe('0.5');
  expect(formatCreditQuanta(1)).toBe('0.001');
  expect(formatCreditQuanta(-1)).toBe('-0.001');
  expect(formatCreditQuanta(1500)).toBe('1.5');
});

test('localized exact formatting rejects values that cannot represent integer source units', () => {
  expect(formatCreditQuanta(1501, 'ar-EG')).toBe('١٫٥٠١');
  for (const value of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => formatCreditQuanta(value)).toThrow('SAFE_INTEGER_REQUIRED');
    expect(() => formatMinorUnits(value)).toThrow('SAFE_INTEGER_REQUIRED');
  }
});

test('numeric input values preserve exact fractions without grouping or locale separators', () => {
  expect(scaledIntegerInput(Number.MAX_SAFE_INTEGER, 2)).toBe('90071992547409.91');
  expect(scaledIntegerInput(Number.MAX_SAFE_INTEGER, 3)).toBe('9007199254740.991');
  expect(scaledIntegerInput(57500, 2)).toBe('575');
  expect(scaledIntegerInput(-1, 3)).toBe('-0.001');
  expect(() => scaledIntegerInput(NaN, 3)).toThrow('SAFE_INTEGER_REQUIRED');
});

test('decimal input parsing preserves every minor unit and entitlement quantum', () => {
  expect(parseScaledIntegerInput('90071992547409.90', 2)).toBe(9007199254740990);
  expect(parseScaledIntegerInput('9007199254740.989', 3)).toBe(9007199254740989);
  expect(parseScaledIntegerInput('9007199254740.991', 3)).toBe(Number.MAX_SAFE_INTEGER);
  expect(parseScaledIntegerInput('575', 2)).toBe(57500);
  expect(parseScaledIntegerInput('0.5', 3)).toBe(500);
  expect(parseScaledIntegerInput('0', 2)).toBe(0);
  for (const scale of [2, 3] as const) {
    for (const value of [0, 1, 1234, 57500, 9007199254740989, Number.MAX_SAFE_INTEGER]) {
      expect(parseScaledIntegerInput(scaledIntegerInput(value, scale), scale)).toBe(value);
    }
  }
});

test('decimal input parsing rejects rounding, unsafe integers and alternate numeric syntax', () => {
  for (const value of ['', ' ', '-1', '+1', '1e2', 'NaN', 'Infinity', '1,000', ' 1', '1 ', '.5', '1.', '1.001', '90071992547409.92']) {
    expect(() => parseScaledIntegerInput(value, 2)).toThrow('DECIMAL_INPUT_REQUIRED');
  }
  expect(() => parseScaledIntegerInput('1.0001', 3)).toThrow('DECIMAL_INPUT_REQUIRED');
  expect(() => parseScaledIntegerInput('9007199254740.992', 3)).toThrow('DECIMAL_INPUT_REQUIRED');
});
