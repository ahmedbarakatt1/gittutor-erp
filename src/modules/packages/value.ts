const maximum=BigInt(Number.MAX_SAFE_INTEGER);
export function exactInteger(value:number,{positive=false,signed=false}:{positive?:boolean;signed?:boolean}={}){
  if(!Number.isSafeInteger(value)||(!signed&&value<0)||(positive&&value<=0))throw new Error('VALIDATION_ERROR');
  return BigInt(value);
}
function output(value:bigint){if(value>maximum||value< -maximum)throw new Error('AMOUNT_OUT_OF_RANGE');return Number(value)}
export function allocateSequential(input:{remaining_credit_quanta:number;remaining_value_minor:number;requested_credit_quanta:number}){
  const quantity=exactInteger(input.remaining_credit_quanta),value=exactInteger(input.remaining_value_minor),requested=exactInteger(input.requested_credit_quanta);
  if(quantity===0n&&value!==0n)throw new Error('VALIDATION_ERROR');
  if(requested>quantity)throw new Error('INSUFFICIENT_ENTITLEMENT');
  const allocated=requested===quantity?value:quantity===0n?0n:value*requested/quantity;
  return {allocated_value_minor:output(allocated),remaining_credit_quanta:output(quantity-requested),remaining_value_minor:output(value-allocated)};
}
export function allocateBatch(input:{total_value_minor:number;allocations:readonly{allocation_id:string;credit_quanta:number}[]}){
  const total=exactInteger(input.total_value_minor);
  if(!input.allocations.length||new Set(input.allocations.map(row=>row.allocation_id)).size!==input.allocations.length)throw new Error('VALIDATION_ERROR');
  const rows=input.allocations.map(row=>{
    if(!row.allocation_id||row.allocation_id.length>200)throw new Error('VALIDATION_ERROR');
    return {id:row.allocation_id,weight:exactInteger(row.credit_quanta,{positive:true}),value:0n,remainder:0n};
  });
  const weight=rows.reduce((sum,row)=>sum+row.weight,0n);
  for(const row of rows){row.value=total*row.weight/weight;row.remainder=total*row.weight%weight}
  const residual=total-rows.reduce((sum,row)=>sum+row.value,0n);
  rows.sort((a,b)=>a.remainder===b.remainder?(a.id<b.id?-1:1):a.remainder>b.remainder?-1:1);
  for(let i=0;i<Number(residual);i++)rows[i].value++;
  return rows.sort((a,b)=>a.id<b.id?-1:1).map(row=>({allocation_id:row.id,value_minor:output(row.value)}));
}
export type LotBuckets={granted:number;transferred_in:number;adjustment:number;available:number;reserved:number;consumed:number;expired:number;transferred_out:number};
export function assertLotConservation(input:{quantity:LotBuckets;value:LotBuckets}){
  for(const dimension of [input.quantity,input.value]){
    const values=Object.fromEntries(Object.entries(dimension).map(([key,value])=>[key,exactInteger(value,{signed:key==='adjustment'})])) as Record<keyof LotBuckets,bigint>;
    if(values.granted+values.transferred_in+values.adjustment!==values.available+values.reserved+values.consumed+values.expired+values.transferred_out)throw new Error('CONSERVATION_VIOLATION');
  }
  for(const bucket of ['available','reserved','consumed','expired','transferred_out'] as const){if(input.quantity[bucket]===0&&input.value[bucket]!==0)throw new Error('CONSERVATION_VIOLATION')}
}
export function calculateProratedQuanta(input:{delivered_seconds:number;base_duration_minutes:number;rounding:'floor'|'ceiling'|'half_up'}){
  const numerator=exactInteger(input.delivered_seconds)*1000n,denominator=exactInteger(input.base_duration_minutes,{positive:true})*60n;
  if(!['floor','ceiling','half_up'].includes(input.rounding))throw new Error('VALIDATION_ERROR');
  const quotient=numerator/denominator,remainder=numerator%denominator;
  const increment=input.rounding==='ceiling'?remainder>0n:input.rounding==='half_up'?remainder*2n>=denominator:false;
  return output(quotient+(increment?1n:0n));
}
export function convertQuanta(input:{source_credit_quanta:number;source_base_duration_minutes:number;target_base_duration_minutes:number;target_credit_quanta?:number;carrying_value_minor:number}){
  const source=exactInteger(input.source_credit_quanta,{positive:true}),oldDuration=exactInteger(input.source_base_duration_minutes,{positive:true}),newDuration=exactInteger(input.target_base_duration_minutes,{positive:true});
  exactInteger(input.carrying_value_minor);
  const target=input.target_credit_quanta===undefined?source*oldDuration/newDuration:exactInteger(input.target_credit_quanta,{positive:true});
  if(target===0n)throw new Error('INSUFFICIENT_ENTITLEMENT');
  const delta=target*newDuration-source*oldDuration;
  if(delta>0n)throw new Error('SERVICE_CONSERVATION_VIOLATION');
  return {source_credit_quanta:input.source_credit_quanta,target_credit_quanta:output(target),quantity_adjustment_credit_quanta:output(target-source),service_duration_delta_second_quanta:output(delta*60n),carrying_value_minor:input.carrying_value_minor};
}
export function convertLotAllocations(input:{allocations:readonly{lot_id:string;credit_quanta:number;value_minor:number;expires_at:string|null}[];target_credit_quanta:number}){
  exactInteger(input.target_credit_quanta,{positive:true});
  for(const row of input.allocations)exactInteger(row.value_minor);
  const targets=allocateBatch({total_value_minor:input.target_credit_quanta,allocations:input.allocations.map(row=>({allocation_id:row.lot_id,credit_quanta:row.credit_quanta}))});
  return targets.map(target=>{
    if(target.value_minor===0)throw new Error('INSUFFICIENT_ENTITLEMENT');
    const source=input.allocations.find(row=>row.lot_id===target.allocation_id)!;
    return {lot_id:source.lot_id,source_credit_quanta:source.credit_quanta,target_credit_quanta:target.value_minor,value_minor:source.value_minor,expires_at:source.expires_at};
  });
}

/** Each original expiry/value lineage must conserve service independently. */
export function assertConversionLotService(allocations:readonly{source_credit_quanta:number;target_credit_quanta:number}[],sourceDurationMinutes:number,targetDurationMinutes:number){
 const sourceDuration=exactInteger(sourceDurationMinutes,{positive:true}),targetDuration=exactInteger(targetDurationMinutes,{positive:true});
 for(const allocation of allocations){
  if(exactInteger(allocation.target_credit_quanta,{positive:true})*targetDuration>exactInteger(allocation.source_credit_quanta,{positive:true})*sourceDuration)throw new Error('SERVICE_CONSERVATION_VIOLATION');
 }
}
