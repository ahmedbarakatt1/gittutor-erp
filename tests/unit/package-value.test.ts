import { expect, test } from 'vitest';
import { allocateBatch, allocateSequential, assertLotConservation, calculateProratedQuanta, convertQuanta,convertLotAllocations,assertConversionLotService } from '../../src/modules/packages/value';
import { describeCoverage, packageExpiryInstant } from '../../src/modules/packages/eligibility';

test.each([
  [100000,[1000,1000,1000],[33333,33333,33334]],
  [100001,[1000,1000,1000],[33333,33334,33334]],
  [100000,[1000,500,1500],[33333,16666,50001]],
] as const)('sequential allocation conserves %i through exact remaining quantity/value', (total,parts,expected)=>{
  let state:{remaining_credit_quanta:number;remaining_value_minor:number}={remaining_credit_quanta:3000,remaining_value_minor:total};
  const amounts=parts.map(requested_credit_quanta=>{const next=allocateSequential({...state,requested_credit_quanta});state=next;return next.allocated_value_minor});
  expect(amounts).toEqual(expected);expect(state.remaining_credit_quanta).toBe(0);expect(state.remaining_value_minor).toBe(0);
});
test('batch largest remainder uses stable IDs, independently of input ordering',()=>{
  const allocations=[{allocation_id:'c',credit_quanta:1000},{allocation_id:'a',credit_quanta:1000},{allocation_id:'b',credit_quanta:1000}];
  expect(allocateBatch({total_value_minor:100001,allocations})).toEqual([{allocation_id:'a',value_minor:33334},{allocation_id:'b',value_minor:33334},{allocation_id:'c',value_minor:33333}]);
  expect(()=>allocateBatch({total_value_minor:5,allocations:[allocations[0],allocations[0]]})).toThrow('VALIDATION_ERROR');
});
test('half consumption allocates the saved reservation value and preserves zero-value quantity',()=>{
  expect(allocateSequential({remaining_credit_quanta:1000,remaining_value_minor:50000,requested_credit_quanta:500})).toEqual({allocated_value_minor:25000,remaining_credit_quanta:500,remaining_value_minor:25000});
  expect(allocateSequential({remaining_credit_quanta:1000,remaining_value_minor:0,requested_credit_quanta:500})).toEqual({allocated_value_minor:0,remaining_credit_quanta:500,remaining_value_minor:0});
});
test('safe output permits exact large intermediates without floating-point rounding',()=>{
  expect(allocateSequential({remaining_credit_quanta:Number.MAX_SAFE_INTEGER,remaining_value_minor:Number.MAX_SAFE_INTEGER,requested_credit_quanta:Number.MAX_SAFE_INTEGER-1}).allocated_value_minor).toBe(Number.MAX_SAFE_INTEGER-1);
});
test.each([-1,0.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN])('invalid quantity %s cannot enter a movement calculation',quantity=>{
  expect(()=>allocateSequential({remaining_credit_quanta:1000,remaining_value_minor:1000,requested_credit_quanta:quantity})).toThrow();
});
test('overspending and zero-quantity orphan value fail before allocation',()=>{
  expect(()=>allocateSequential({remaining_credit_quanta:1000,remaining_value_minor:50000,requested_credit_quanta:1001})).toThrow('INSUFFICIENT_ENTITLEMENT');
  expect(()=>allocateSequential({remaining_credit_quanta:0,remaining_value_minor:1,requested_credit_quanta:0})).toThrow('VALIDATION_ERROR');
});
test('quantity and value conservation are independent and all normal buckets stay nonnegative',()=>{
  const quantity={granted:3000,transferred_in:0,adjustment:0,available:1500,reserved:500,consumed:1000,expired:0,transferred_out:0};
  const value={granted:150000,transferred_in:0,adjustment:0,available:75000,reserved:25000,consumed:50000,expired:0,transferred_out:0};
  expect(()=>assertLotConservation({quantity,value})).not.toThrow();
  expect(()=>assertLotConservation({quantity:{...quantity,available:1501},value})).toThrow('CONSERVATION_VIOLATION');
  expect(()=>assertLotConservation({quantity,value:{...value,consumed:50001}})).toThrow('CONSERVATION_VIOLATION');
  expect(()=>assertLotConservation({quantity:{...quantity,reserved:-1,available:2001},value})).toThrow('VALIDATION_ERROR');
});
test('duration proration uses integer seconds and explicit whole-quanta rounding',()=>{
  expect(calculateProratedQuanta({delivered_seconds:1800,base_duration_minutes:60,rounding:'floor'})).toBe(500);
  expect(calculateProratedQuanta({delivered_seconds:1,base_duration_minutes:60,rounding:'floor'})).toBe(0);
  expect(calculateProratedQuanta({delivered_seconds:1,base_duration_minutes:60,rounding:'ceiling'})).toBe(1);
  expect(calculateProratedQuanta({delivered_seconds:2,base_duration_minutes:60,rounding:'half_up'})).toBe(1);
});
test('conversion preserves carrying value with explicit unit adjustment and exact service loss',()=>{
  expect(convertQuanta({source_credit_quanta:1000,source_base_duration_minutes:60,target_base_duration_minutes:90,carrying_value_minor:50000})).toEqual({source_credit_quanta:1000,target_credit_quanta:666,quantity_adjustment_credit_quanta:-334,service_duration_delta_second_quanta:-3600,carrying_value_minor:50000});
  expect(()=>convertQuanta({source_credit_quanta:1000,source_base_duration_minutes:60,target_base_duration_minutes:90,target_credit_quanta:667,carrying_value_minor:50000})).toThrow('SERVICE_CONSERVATION_VIOLATION');
});
test('conversion distributes target units with stable IDs while preserving every lot value and expiry',()=>{
 const allocations=[{lot_id:'b',credit_quanta:1000,value_minor:33333,expires_at:'2027-02-01T10:00:00Z'},{lot_id:'a',credit_quanta:1000,value_minor:66667,expires_at:'2027-01-01T10:00:00Z'}];
 expect(convertLotAllocations({allocations,target_credit_quanta:1333})).toEqual([{lot_id:'a',source_credit_quanta:1000,target_credit_quanta:667,value_minor:66667,expires_at:'2027-01-01T10:00:00Z'},{lot_id:'b',source_credit_quanta:1000,target_credit_quanta:666,value_minor:33333,expires_at:'2027-02-01T10:00:00Z'}]);
 expect(()=>convertLotAllocations({allocations,target_credit_quanta:1})).toThrow('INSUFFICIENT_ENTITLEMENT');
});
test.each([50000,25000,0])('full named coverage carrying %i never creates a current-price shortfall',carrying_value_minor=>{
  expect(describeCoverage({coverage_rule:'named_entitlement_covers_eligible_occurrence',required_credit_quanta:1000,reserved_credit_quanta:1000,carrying_value_minor,accepted_customer_price_minor:57500,remaining_service_terms:null})).toEqual({service_satisfied:true,top_up_minor:0,requires_review:false});
});
test('value mode computes the explicit monetary top-up; partial named mode cannot infer it',()=>{
  const input={required_credit_quanta:1000,reserved_credit_quanta:1000,carrying_value_minor:50000,accepted_customer_price_minor:57500,remaining_service_terms:null};
  expect(describeCoverage({...input,coverage_rule:'allocated_value_with_explicit_top_up'}).top_up_minor).toBe(7500);
  expect(describeCoverage({...input,carrying_value_minor:25000,coverage_rule:'allocated_value_with_explicit_top_up'}).top_up_minor).toBe(32500);
  expect(describeCoverage({...input,reserved_credit_quanta:500,carrying_value_minor:25000,coverage_rule:'named_entitlement_covers_eligible_occurrence'})).toEqual({service_satisfied:false,top_up_minor:null,requires_review:true});
  expect(describeCoverage({...input,reserved_credit_quanta:500,coverage_rule:'named_entitlement_covers_eligible_occurrence',remaining_service_terms:{credit_quanta:500,price_minor:12345}}).top_up_minor).toBe(12345);
});
test('elapsed expiry remains exactly one day over Cairo DST changes and rejects overflow',()=>{
  expect(packageExpiryInstant('2026-04-23T21:30:00Z',{expiry_mode:'days_from_grant',expiry_days:1,expiry_clock:'elapsed_24_hour_days'})).toBe('2026-04-24T21:30:00.000Z');
  expect(packageExpiryInstant('2026-10-29T20:30:00Z',{expiry_mode:'none',expiry_days:null,expiry_clock:'elapsed_24_hour_days'})).toBeNull();
  expect(()=>packageExpiryInstant('9999-12-31T23:59:59Z',{expiry_mode:'days_from_grant',expiry_days:1,expiry_clock:'elapsed_24_hour_days'})).toThrow('INVALID_TIME');
});

test('a rounded conversion cannot move extra service into a source lot with its own expiry',()=>{
 const mapping=convertLotAllocations({allocations:[{lot_id:'a',credit_quanta:1,value_minor:0,expires_at:null},{lot_id:'b',credit_quanta:2,value_minor:0,expires_at:null}],target_credit_quanta:2});
 expect(()=>assertConversionLotService(mapping,60,90)).toThrow('SERVICE_CONSERVATION_VIOLATION');
 expect(()=>assertConversionLotService([{source_credit_quanta:1000,target_credit_quanta:666}],60,90)).not.toThrow();
});
