import { z } from 'zod';

const money=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const basisPoints=z.number().int().min(0).max(10000);
const rounding=z.enum(['ceiling_minor_unit','floor_minor_unit','half_up_minor_unit']);
export function calculateDepositThreshold(amountMinor:number,points:number,rule:z.infer<typeof rounding>):number{
  if(!money.safeParse(amountMinor).success||!basisPoints.safeParse(points).success||!rounding.safeParse(rule).success)throw new Error('VALIDATION_ERROR');
  const numerator=BigInt(amountMinor)*BigInt(points);
  const adjustment=rule==='ceiling_minor_unit'?9999n:rule==='half_up_minor_unit'?5000n:0n;
  const result=Number((numerator+adjustment)/10000n);
  if(!Number.isSafeInteger(result))throw new Error('AMOUNT_OUT_OF_RANGE');
  return result;
}
