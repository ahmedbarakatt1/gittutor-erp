import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {paymentFixture} from '../helpers/payments';
import {createVerifiedRefund} from '../helpers/refunds';
import {invokePaymentCommandWithStatus} from '../../src/modules/payments/commands';
import {listRefundSources,listRefundAttempts,listRefundReversals} from '../../src/modules/payments/queries';
test('GT-1505 surplus refund keeps unknown reserved, settles once, and returns partial outgoing cash to its original source',async()=>{
 const f=await paymentFixture();try{
  const refund=await createVerifiedRefund(f);
  expect((await listRefundSources(f.learner,{view:'customer',limit:100})).items.some(row=>row.source_id===refund.transferId)).toBe(true);
  const approved=(await invokePaymentCommandWithStatus(f.admin,'approve_refund',{p_refund_id:refund.refundId,p_remedy_id:null,p_destination_version_id:refund.destinationVersionId,p_amount_minor:5000,p_reason:'Verified surplus only',p_expected_version:refund.version,p_idempotency_key:randomUUID()})).data;
  expect(approved).toMatchObject({reserved_minor:5000,state:'approved'});
  const attempt=(await invokePaymentCommandWithStatus(f.admin,'record_refund_attempt',{p_refund_id:refund.refundId,p_external_reference:`synthetic-out-${randomUUID()}`,p_expected_version:approved.version,p_idempotency_key:randomUUID()})).data;
  const evidence=await f.evidence({purpose:'refund_outcome',parentType:'refund_attempt',parentId:attempt.attempt_id});
  const unknown=(await invokePaymentCommandWithStatus(f.admin,'reconcile_refund',{p_refund_id:refund.refundId,p_attempt_id:attempt.attempt_id,p_outcome:'unknown',p_evidence_file_id:evidence,p_external_reference:`synthetic-unknown-${randomUUID()}`,p_settled_at:null,p_expected_version:attempt.version,p_idempotency_key:randomUUID()})).data;
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[refund.transferId])).rows[0].data).toMatchObject({gross_settled_minor:55000,refund_reserved_minor:5000,refund_settled_minor:0,available_minor:50000});
  expect((await f.admin.rpc('record_refund_attempt',{p_refund_id:refund.refundId,p_external_reference:`synthetic-repeat-${randomUUID()}`,p_expected_version:unknown.version,p_idempotency_key:randomUUID()})).error?.message).toBe('STATE_CONFLICT');
  const settleArgs={p_refund_id:refund.refundId,p_attempt_id:attempt.attempt_id,p_outcome:'settled' as const,p_evidence_file_id:evidence,p_external_reference:`synthetic-settled-${randomUUID()}`,p_settled_at:new Date(Date.now()-1000).toISOString(),p_expected_version:unknown.version,p_idempotency_key:randomUUID()};
  const settled=(await invokePaymentCommandWithStatus(f.admin,'reconcile_refund',settleArgs)).data;expect(settled.state).toBe('settled');expect((await invokePaymentCommandWithStatus(f.admin,'reconcile_refund',settleArgs)).data).toEqual(settled);
  const returnedEvidence=await f.evidence({purpose:'refund_reversal',parentType:'refund_attempt',parentId:attempt.attempt_id});
  const returnArgs={p_refund_id:refund.refundId,p_attempt_id:attempt.attempt_id,p_external_reversal_id:`synthetic-return-${randomUUID()}`,p_amount_minor:2000,p_evidence_file_id:returnedEvidence,p_effective_at:new Date(Date.now()-1000).toISOString(),p_expected_version:settled.version,p_idempotency_key:randomUUID()};
  const returned=(await invokePaymentCommandWithStatus(f.admin,'record_refund_reversal',returnArgs)).data;expect(returned.returned_minor).toBe(2000);expect((await invokePaymentCommandWithStatus(f.admin,'record_refund_reversal',returnArgs)).data).toEqual(returned);
  expect((await listRefundAttempts(f.learner,refund.refundId)).items).toEqual([expect.objectContaining({attempt_id:attempt.attempt_id,state:'settled'})]);
  expect((await listRefundReversals(f.learner,refund.refundId)).items).toEqual([expect.objectContaining({amount_minor:2000})]);
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[refund.transferId])).rows[0].data).toMatchObject({gross_settled_minor:55000,refund_reserved_minor:0,refund_settled_minor:5000,refund_returned_minor:2000,available_minor:52000});
  expect((await f.database.query("select account_code,sum(signed_minor)::int total from finance_private.ledger_lines where transfer_id=$1 group by account_code order by account_code",[refund.transferId])).rows).toEqual([{account_code:'channel_cash',total:52000},{account_code:'unapplied_customer_funds',total:-52000}]);
 }finally{await f.close();}
});
