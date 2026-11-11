import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {paymentFixture} from '../helpers/payments';
import {createVerifiedRefund} from '../helpers/refunds';
import {invokePaymentCommandWithStatus} from '../../src/modules/payments/commands';

test('an evidenced bank reversal after a settled refund preserves negative exposure and original outgoing cash',async()=>{
 const f=await paymentFixture();try{
  const r=await createVerifiedRefund(f,5000);
  const approved=(await invokePaymentCommandWithStatus(f.admin,'approve_refund',{p_refund_id:r.refundId,p_remedy_id:null,p_destination_version_id:r.destinationVersionId,p_amount_minor:5000,p_reason:'Unused source',p_expected_version:r.version,p_idempotency_key:randomUUID()})).data;
  const attempt=(await invokePaymentCommandWithStatus(f.admin,'record_refund_attempt',{p_refund_id:r.refundId,p_external_reference:randomUUID(),p_expected_version:approved.version,p_idempotency_key:randomUUID()})).data;
  const outcomeFile=await f.evidence({purpose:'refund_outcome',parentType:'refund_attempt',parentId:attempt.attempt_id});
  await invokePaymentCommandWithStatus(f.admin,'reconcile_refund',{p_refund_id:r.refundId,p_attempt_id:attempt.attempt_id,p_outcome:'settled',p_evidence_file_id:outcomeFile,p_external_reference:randomUUID(),p_settled_at:new Date(Date.now()-1000).toISOString(),p_expected_version:attempt.version,p_idempotency_key:randomUUID()});
  const file=await f.evidence({purpose:'transfer_reversal',parentType:'transfer',parentId:r.transferId});
  const version=(await f.database.query('select version from finance_private.incoming_transfers where id=$1',[r.transferId])).rows[0].version;
  const args={p_transfer_id:r.transferId,p_external_reversal_id:randomUUID(),p_amount_minor:55000,p_effective_at:new Date(Date.now()-1000).toISOString(),p_evidence_file_id:file,p_expected_version:version,p_idempotency_key:randomUUID()};
  const reversal=(await invokePaymentCommandWithStatus(f.admin,'record_transfer_reversal',args)).data;
  expect(reversal.reconciliation_exception_id).not.toBeNull();expect((await invokePaymentCommandWithStatus(f.admin,'record_transfer_reversal',args)).data).toEqual(reversal);
  const balance=(await f.database.query('select finance_private.finance_transfer_balance($1) data',[r.transferId])).rows[0].data;
  expect(balance).toMatchObject({gross_settled_minor:55000,reversed_minor:55000,refund_settled_minor:5000,unapplied_signed_minor:-5000,available_minor:0,recovery_exposure_minor:5000,reconciliation_state:'requires_review'});
  const resolved=(await invokePaymentCommandWithStatus(f.admin,'resolve_transfer_reversal',{p_reversal_id:reversal.reversal_id,p_allocations:[],p_unapplied_minor:50000,p_reason:'Only remaining pre-reversal unused cash can absorb the loss',p_expected_version:reversal.version,p_idempotency_key:randomUUID()})).data;
  expect(resolved.remaining_unresolved_minor).toBe(5000);
  await expect(invokePaymentCommandWithStatus(f.admin,'resolve_transfer_reversal',{p_reversal_id:reversal.reversal_id,p_allocations:[],p_unapplied_minor:5000,p_reason:'Cannot erase outgoing refund exposure',p_expected_version:resolved.version,p_idempotency_key:randomUUID()})).rejects.toThrow('AMOUNT_OUT_OF_RANGE');
  expect((await f.database.query("select sum(signed_minor)::int total from finance_private.ledger_lines where transfer_id=$1 and account_code='channel_cash'",[r.transferId])).rows[0].total).toBe(-5000);
 }finally{await f.close();}
});
