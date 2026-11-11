import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';

test('GT-1402 inactive proof author and expired reviewer claim cannot authorize allocation or replay', async () => {
 const f=await paymentFixture({charge:'enrollment'});
 try {
  const account=await f.receiving(),transfer=await f.transfer(account.id),receipt=await f.receipt(account.versionId);
  const claim=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const args={p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:f.chargeId,amount_minor:50000}],p_expected_version:claim.version,p_idempotency_key:randomUUID()};
  const token=(await f.reviewer.auth.getSession()).data.session!.access_token;
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  const scoped=async(setup:string,values:unknown[])=>{
   await f.database.query('begin');
   try {
    await f.database.query(setup,values);
    await f.database.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    await f.database.query('set local role authenticated');
    try {await f.database.query('select api.allocate_transfer($1,$2,$3,$4,$5,$6,$7)',[args.p_case_id,args.p_transfer_id,args.p_evidence_version,args.p_payment_plan_id,JSON.stringify(args.p_allocations),args.p_expected_version,args.p_idempotency_key]);return null;} catch(error){return(error as Error).message;}
   }finally{await f.database.query('rollback');}
  };
  expect(await scoped('update app_private.accounts set active=false where id=$1',[f.learnerAccountId])).toBe('CONSENT_REQUIRED');
  await f.rpc('allocate_transfer',args,f.reviewer);
  expect(await scoped("update app_private.review_cases set claim_expires_at=now()-interval '1 second' where id=$1",[receipt.case_id])).toBe('OWNER_REQUIRED');
 }finally{await f.close();}
});
