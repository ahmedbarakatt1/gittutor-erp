import { describe, expect, test } from 'vitest';
import manifest from '../../contracts/pricing-policy.json';
import { calculateGroupPricing, projectCustomerPricing, validateExactFee } from '../../src/modules/catalog/pricing';

const customer = { currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: 60, group_tiers: manifest.customer_pricing.group_tiers, private_seat_price_minor: null };
const compensation = { currency: 'EGP', group_fee_bands: manifest.internal_compensation.group_fee_bands, private_fee_rule: null };
describe('T03 exact approved pricing', () => {
  test.each([[2, 45000, 115000, 70000], [3, 62500, 165000, 102500], [4, 72500, 200000, 127500]])('GT-1201 GT-1202 GT-1203 group %i arithmetic', (size, fee, tuition, contribution) => {
    expect(calculateGroupPricing(customer, compensation, size, fee)).toEqual({ customer_tuition_total_minor: tuition, approved_tutor_fee_minor: fee, internal_contribution_minor: contribution });
  });
  test.each([[2,45000],[3,60000],[3,65000],[4,70000],[4,75000]])('GT-1202 GT-1203 inclusive band %i/%i', (size,fee) => {
    expect(validateExactFee(compensation, size, fee)).toBe(fee);
  });
  test.each([null, 59999, 65001, 62500.5, NaN, Infinity])('GT-1205 exact fee rejects %s', fee => {
    expect(() => validateExactFee(compensation, 3, fee)).toThrow('VALIDATION_ERROR');
  });
  test.each([0,1,5,2.5,-2])('GT-1204 unsupported size %s has no fallback', size => {
    expect(() => calculateGroupPricing(customer, compensation, size, 45000)).toThrow('VALIDATION_ERROR');
  });
  test('GT-1204 rejects incompatible currency and unsafe intermediate totals', () => {
    expect(() => calculateGroupPricing({ ...customer, currency: 'USD' }, compensation, 2, 45000)).toThrow('VALIDATION_ERROR');
    expect(() => calculateGroupPricing({ ...customer, group_tiers: [{ tier_id: 'group_2', group_size: 2, seat_price_minor: Number.MAX_SAFE_INTEGER }] }, compensation, 2, 45000)).toThrow('AMOUNT_OUT_OF_RANGE');
  });
  test('GT-1212 customer JSON/email/export projection never forwards privileged or unknown fields', () => {
    const projected = projectCustomerPricing({ ...customer, internal_compensation: compensation, internal_notes: 'SECRET_MARKER', margin_minor: 70000 }, 3, '9d9a5658-a7e2-42d2-8195-4cb1a18d56f0', 'f0fb79a4-1e58-4775-b927-c3de9567b795');
    expect(Object.keys(projected).sort()).toEqual([...manifest.customer_pricing.projection_fields].sort());
    expect(projected.contract_id).toBe('git_tutor_customer_pricing');
    for (const serialized of [JSON.stringify(projected), Object.values(projected).join(','), Object.entries(projected).map(([k,v]) => `${k}: ${v}`).join('\n')]) {
      expect(serialized).not.toMatch(/fee|margin|compensation|SECRET_MARKER|internal_notes/);
    }
    expect(projected.seat_price_minor).toBe(55000);
  });
});
