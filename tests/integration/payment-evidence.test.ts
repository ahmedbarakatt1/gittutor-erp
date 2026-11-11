import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {paymentFixture} from '../helpers/payments';
import {listPaymentEvidence} from '../../src/modules/payments/queries';
test('payment evidence selector is finite-action, exact target and current-role scoped',async()=>{
 const f=await paymentFixture();try{
  const account=await f.receiving(),transfer=await f.transfer(account.id,55000,false,false);
  const ownership=await f.evidence({purpose:'payer_ownership',parentType:'transfer',parentId:transfer.id});
  const wrong=await f.evidence({purpose:'payer_ownership',parentType:'transfer',parentId:randomUUID()});
  expect((await f.reviewer.rpc('list_payment_evidence',{p_action:'verify_transfer_settlement',p_target_id:transfer.id,p_cursor:null,p_limit:100})).error).toBeNull();
  const statements=await listPaymentEvidence(f.reviewer,{action:'verify_transfer_settlement',target_id:transfer.id,limit:100});
  expect(statements.items.map(row=>row.file_id)).toContain(transfer.fileId);expect(statements.items.map(row=>row.file_id)).not.toContain(ownership);
  const owners=await listPaymentEvidence(f.reviewer,{action:'bind_transfer_payer',target_id:transfer.id,limit:100});expect(owners.items.map(row=>row.file_id)).toEqual([ownership]);expect(owners.items.map(row=>row.file_id)).not.toContain(wrong);
  expect((await f.learner.rpc('list_payment_evidence',{p_action:'bind_transfer_payer',p_target_id:transfer.id,p_cursor:null,p_limit:25})).error?.message).toBe('FORBIDDEN');
 }finally{await f.close();}
});
