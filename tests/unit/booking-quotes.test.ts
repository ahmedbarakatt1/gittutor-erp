import { expect, test } from 'vitest';
import { calculateDepositThreshold } from '../../src/modules/booking/quotes';

test('deposit arithmetic preserves integer rounding and zero without overflowing intermediates',()=>{
  expect(calculateDepositThreshold(57500,2500,'ceiling_minor_unit')).toBe(14375);
  expect(calculateDepositThreshold(1,5000,'floor_minor_unit')).toBe(0);
  expect(calculateDepositThreshold(1,5000,'ceiling_minor_unit')).toBe(1);
  expect(calculateDepositThreshold(1,5000,'half_up_minor_unit')).toBe(1);
  expect(calculateDepositThreshold(1,4999,'half_up_minor_unit')).toBe(0);
  expect(calculateDepositThreshold(57500,0,'ceiling_minor_unit')).toBe(0);
  expect(calculateDepositThreshold(Number.MAX_SAFE_INTEGER,10000,'ceiling_minor_unit')).toBe(Number.MAX_SAFE_INTEGER);
});
test('invalid quote arithmetic cannot silently produce a payment requirement',()=>{
  for(const value of [-1,0.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity])expect(()=>calculateDepositThreshold(value,2500,'ceiling_minor_unit')).toThrow();
  for(const value of [-1,0.5,10001,NaN])expect(()=>calculateDepositThreshold(57500,value,'ceiling_minor_unit')).toThrow();
  expect(()=>calculateDepositThreshold(57500,2500,'unknown' as never)).toThrow();
});
