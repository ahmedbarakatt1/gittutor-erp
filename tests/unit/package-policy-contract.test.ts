import {expect,test} from 'vitest';
import {policyFixture} from './policy-vectors';
import {validatePolicyContent} from '../../src/modules/catalog/policies';

test('new complete package policy requires the explicit funding and expiry clocks',()=>{
 const content=policyFixture('group');const pack=content.package_contract as Record<string,unknown>;
 delete pack.purchase_activation_rule;delete pack.expiry_clock;
 expect(validatePolicyContent(content,{scope:'group',complete:true})).toEqual(expect.arrayContaining(['package_contract.purchase_activation_rule','package_contract.expiry_clock']));
});
test('explicit full-settlement and elapsed-day package rules are accepted',()=>{
 const content=policyFixture('group');Object.assign(content.package_contract as object,{purchase_activation_rule:'full_settled_charge',expiry_clock:'elapsed_24_hour_days'});
 expect(validatePolicyContent(content,{scope:'group',complete:true})).toEqual([]);
});
