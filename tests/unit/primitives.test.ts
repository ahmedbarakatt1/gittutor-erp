import { expect, it } from "vitest";
import { moneyMinor, version, uuid, cairoDate, formatMoney } from "../../src/modules/shared/primitives";

it("money rejects fractional, negative and unsafe amounts", () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) expect(() => moneyMinor(value)).toThrow();
  expect(moneyMinor(57500)).toBe(57500);
});
it("versions and IDs validate their contract", () => {
  expect(() => version(0)).toThrow();
  expect(() => uuid("learner_a")).toThrow();
  expect(uuid("00000000-0000-4000-8000-000000000001")).toContain("000001");
});
it("uses Cairo calendar boundaries and localized money", () => {
  expect(cairoDate("2026-10-31T22:30:00Z")).toBe("2026-11-01");
  expect(formatMoney(57500)).toContain("575");
});
