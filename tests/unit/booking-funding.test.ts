import { expect, test } from 'vitest';
import { calculateFundingAmounts } from '../../src/modules/booking/funding';
import { fundingSchema } from '../../src/modules/booking/queries';

const base = { netChargeMinor: 57500, allocatedCashMinor: 0, appliedPackageValueMinor: 0, depositBasisPoints: 5000, depositRounding: 'ceiling_minor_unit' as const };
test('money funding distinguishes deposit eligibility from complete settlement', () => {
  expect(calculateFundingAmounts({ ...base, netChargeMinor: 50000, allocatedCashMinor: 25000 })).toEqual({ requiredMinor: 25000, appliedMinor: 25000, balanceMinor: 25000, additionalRequiredMinor: 0, financiallyEligible: true });
  expect(calculateFundingAmounts({ ...base, netChargeMinor: 50000, allocatedCashMinor: 24999 }).additionalRequiredMinor).toBe(1);
});
test('value coverage counts its exact carrying value once against the gross accepted deposit basis', () => {
  expect(calculateFundingAmounts({ ...base, appliedPackageValueMinor: 25000 })).toMatchObject({ requiredMinor: 28750, balanceMinor: 32500, additionalRequiredMinor: 3750, financiallyEligible: false });
  expect(calculateFundingAmounts({ ...base, appliedPackageValueMinor: 25000, allocatedCashMinor: 3750 })).toMatchObject({ appliedMinor: 28750, balanceMinor: 28750, additionalRequiredMinor: 0, financiallyEligible: true });
  expect(calculateFundingAmounts({ ...base, appliedPackageValueMinor: 50000 })).toMatchObject({ requiredMinor: 28750, balanceMinor: 7500, additionalRequiredMinor: 0 });
});
test('full named coverage uses its zero issued net debt independently from historical lot value', () => {
  expect(calculateFundingAmounts({ ...base, netChargeMinor: 0 })).toEqual({ requiredMinor: 0, appliedMinor: 0, balanceMinor: 0, additionalRequiredMinor: 0, financiallyEligible: true });
  expect(calculateFundingAmounts({ ...base, netChargeMinor: 17500, allocatedCashMinor: 8750 })).toMatchObject({ requiredMinor: 8750, balanceMinor: 8750, financiallyEligible: true });
});
test('exact safe-integer intermediates retain deposit rounding and residuals', () => {
  expect(calculateFundingAmounts({ ...base, netChargeMinor: Number.MAX_SAFE_INTEGER, depositBasisPoints: 9999, allocatedCashMinor: 9006298534815517 })).toMatchObject({ requiredMinor: 9006298534815517, balanceMinor: 900719925474, financiallyEligible: true });
  expect(calculateFundingAmounts({ ...base, netChargeMinor: 1, depositRounding: 'floor_minor_unit' })).toMatchObject({ requiredMinor: 0, balanceMinor: 1 });
  expect(calculateFundingAmounts({ ...base, netChargeMinor: 1, depositRounding: 'half_up_minor_unit' })).toMatchObject({ requiredMinor: 1, balanceMinor: 1 });
});
test('invalid or over-applied amounts cannot masquerade as settled funding', () => {
  for (const invalid of [{ netChargeMinor: -1 }, { allocatedCashMinor: 0.5 }, { appliedPackageValueMinor: NaN }, { depositBasisPoints: 10001 }, { netChargeMinor: Number.MAX_SAFE_INTEGER + 1 }, { allocatedCashMinor: 57501 }, { allocatedCashMinor: 30000, appliedPackageValueMinor: 30000 }]) expect(() => calculateFundingAmounts({ ...base, ...invalid })).toThrow();
});

test('ready funding distinguishes exact conditional money from ordinary booking eligibility', () => {
  const ready = { integration_state: 'ready', eligible: false, financially_eligible: true, reason: 'AMENDMENT_PENDING', charge_id: '20000000-0000-4000-8000-000000000001', net_charge_minor: 55000, allocated_minor: 27500, balance_minor: 27500, required_for_confirmation_minor: 27500, reserved_credit_quanta: 0, allocated_package_value_minor: 0, top_up_minor: 55000, additional_required_minor: 0, conditional_amendment_id: '20000000-0000-4000-8000-000000000002', funding_quote_id: '20000000-0000-4000-8000-000000000003', reconciliation_state: 'clear' };
  expect(fundingSchema.safeParse(ready).success).toBe(true);
  expect(fundingSchema.safeParse({ ...ready, eligible: true }).success).toBe(false);
  expect(fundingSchema.safeParse({ ...ready, fee_minor: 60000 }).success).toBe(false);
  expect(fundingSchema.safeParse({ ...ready, reason: 'ELIGIBLE', eligible: true, conditional_amendment_id: null, reconciliation_state: 'requires_review' }).success).toBe(false);
});
