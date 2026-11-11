import { calculateDepositThreshold } from './quotes';

export type FundingAmountsInput = {
  netChargeMinor: number;
  allocatedCashMinor: number;
  appliedPackageValueMinor: number;
  depositBasisPoints: number;
  depositRounding: 'ceiling_minor_unit' | 'floor_minor_unit' | 'half_up_minor_unit';
};
export function calculateFundingAmounts(input: FundingAmountsInput): { requiredMinor: number; appliedMinor: number; balanceMinor: number; additionalRequiredMinor: number; financiallyEligible: boolean } {
  for (const amount of [input.netChargeMinor, input.allocatedCashMinor, input.appliedPackageValueMinor]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('AMOUNT_OUT_OF_RANGE');
  }
  const requiredMinor = calculateDepositThreshold(input.netChargeMinor, input.depositBasisPoints, input.depositRounding);
  const applied = BigInt(input.allocatedCashMinor) + BigInt(input.appliedPackageValueMinor);
  if (applied > BigInt(input.netChargeMinor)) throw new Error('FUNDS_EXCEED_CHARGE');
  const additional = BigInt(requiredMinor) - applied;
  return {
    requiredMinor, appliedMinor: Number(applied), balanceMinor: Number(BigInt(input.netChargeMinor) - applied),
    additionalRequiredMinor: additional > 0n ? Number(additional) : 0, financiallyEligible: additional <= 0n,
  };
}
