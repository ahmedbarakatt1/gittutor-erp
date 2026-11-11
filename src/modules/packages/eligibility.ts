import { z } from 'zod';
import { exactInteger } from './value';

export type CoverageRule='named_entitlement_covers_eligible_occurrence'|'allocated_value_with_explicit_top_up';
export function describeCoverage(input:{coverage_rule:CoverageRule;required_credit_quanta:number;reserved_credit_quanta:number;carrying_value_minor:number;accepted_customer_price_minor:number;remaining_service_terms:{credit_quanta:number;price_minor:number}|null}){
  exactInteger(input.required_credit_quanta,{positive:true});exactInteger(input.reserved_credit_quanta);exactInteger(input.carrying_value_minor);exactInteger(input.accepted_customer_price_minor);
  if(input.reserved_credit_quanta>input.required_credit_quanta)throw new Error('VALIDATION_ERROR');
  const service_satisfied=input.reserved_credit_quanta===input.required_credit_quanta;
  if(input.coverage_rule==='allocated_value_with_explicit_top_up'){
    if(input.carrying_value_minor>input.accepted_customer_price_minor)throw new Error('AMOUNT_OUT_OF_RANGE');
    return {service_satisfied,top_up_minor:input.accepted_customer_price_minor-input.carrying_value_minor,requires_review:false};
  }
  if(input.coverage_rule!=='named_entitlement_covers_eligible_occurrence')throw new Error('VALIDATION_ERROR');
  if(service_satisfied)return {service_satisfied,top_up_minor:0,requires_review:false};
  const terms=input.remaining_service_terms;
  if(!terms)return {service_satisfied,top_up_minor:null,requires_review:true};
  exactInteger(terms.credit_quanta,{positive:true});exactInteger(terms.price_minor);
  if(terms.credit_quanta!==input.required_credit_quanta-input.reserved_credit_quanta)throw new Error('VALIDATION_ERROR');
  return {service_satisfied,top_up_minor:terms.price_minor,requires_review:false};
}
const timestamp=z.iso.datetime({offset:true});
export function packageExpiryInstant(grantedAt:string,terms:{expiry_mode:'none'|'days_from_grant';expiry_days:number|null;expiry_clock:'elapsed_24_hour_days'}){
  if(!timestamp.safeParse(grantedAt).success||terms.expiry_clock!=='elapsed_24_hour_days')throw new Error('INVALID_TIME');
  const instant=Date.parse(grantedAt),year=new Date(instant).getUTCFullYear();
  if(!Number.isFinite(instant)||year<1||year>9999)throw new Error('INVALID_TIME');
  if(terms.expiry_mode==='none'){if(terms.expiry_days!==null)throw new Error('VALIDATION_ERROR');return null}
  if(terms.expiry_mode!=='days_from_grant'||terms.expiry_days===null)throw new Error('VALIDATION_ERROR');
  const result=BigInt(instant)+exactInteger(terms.expiry_days,{positive:true})*86400000n;
  if(result>253402300799999n||result< -62135596800000n)throw new Error('INVALID_TIME');
  return new Date(Number(result)).toISOString();
}
