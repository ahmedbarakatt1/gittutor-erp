import {expect,test} from 'vitest';
import {payrollBalance,payrollCommands,payoutAttemptSchema} from '../../src/modules/tutor_pay/payroll';
test('pending and unknown payouts reserve availability without reducing owed, and reversals restore payable',()=>{
 expect(payrollBalance({earned:25000,adjustments:0,settled:15000,reversed:0,reserved:4000})).toEqual({earned_minor:25000,settled_minor:15000,owed_minor:10000,reserved_minor:4000,available_minor:6000,recovery_minor:0});
 expect(payrollBalance({earned:25000,adjustments:-20000,settled:15000,reversed:2000,reserved:0})).toMatchObject({owed_minor:-8000,available_minor:0,recovery_minor:8000});
 expect(()=>payrollBalance({earned:Number.MAX_SAFE_INTEGER,adjustments:1,settled:0,reversed:0,reserved:0})).toThrow();
});
test('payout requests use exact positive unique earning allocations and evidence-backed outcomes',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 expect(payrollCommands.authorize_payout.input.safeParse({p_tutor_id:id,p_destination_version_id:id,p_allocations:[{earning_id:id,amount_minor:1},{earning_id:id,amount_minor:1}],p_idempotency_key:'x'}).success).toBe(false);
 expect(payrollCommands.reconcile_payout.input.safeParse({p_payout_attempt_id:id,p_outcome:'settled',p_receiving_account_id:null,p_external_reference:'ref',p_evidence_file_id:id,p_settled_at:new Date().toISOString(),p_expected_version:1,p_idempotency_key:'x'}).success).toBe(false);
 expect(payoutAttemptSchema.safeParse({encrypted_identifier:{},tutor_fee:100}).success).toBe(false);
});
