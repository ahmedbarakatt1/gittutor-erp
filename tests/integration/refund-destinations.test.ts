import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createIdentifierCipher } from '../../src/server/private-identifiers';
import { createRefundDestinationTransport } from '../../src/server/refund-destination-transport';
import { paymentFixture } from '../helpers/payments';
import { databaseDestinationPort } from '../helpers/refunds';
import { loadLocalSupabase } from '../helpers/supabase';
import { invokePaymentCommandWithStatus } from '../../src/modules/payments/commands';

test('actual worker-bound destination encryption preserves same-plaintext retry and one-use verified approval',async()=>{
 const f=await paymentFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
 try {
  const account=await f.receiving(),transfer=await f.transfer(account.id);
  const refund=(await invokePaymentCommandWithStatus(f.learner,'request_refund',{p_source_type:'unapplied_credit',p_source_id:transfer.id,p_payer_account_id:null,p_amount_minor:5000,p_reason:'Synthetic original payer surplus request',p_idempotency_key:randomUUID()})).data;
  const actor=async(client:typeof f.learner)=>{const session=(await client.auth.getSession()).data.session!;const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());return {account_id:session.user.id,session_id:claims.session_id as string};};
  const cipher=createIdentifierCipher({currentKeyId:'test-v1',currentKey:randomBytes(32).toString('hex')}),port=databaseDestinationPort(worker);
  const payer=createRefundDestinationTransport({cipher,port,client:f.learner}),admin=createRefundDestinationTransport({cipher,port,client:f.admin});
  const evidence=await f.evidence({purpose:'refund_destination',parentType:'refund',parentId:refund.refund_id,uploaderId:f.learnerAccountId});
  const input={p_refund_id:refund.refund_id,p_channel:'instapay',p_identifier:`synthetic-${randomUUID()}@instapay`,p_payee_name:'Synthetic source owner',p_source_evidence_file_id:evidence,p_expected_version:1,p_idempotency_key:randomUUID()};
  const proposed=await payer.propose(await actor(f.learner),input);
  expect((await payer.propose(await actor(f.learner),input)).data).toEqual(proposed.data);
  await expect(payer.propose(await actor(f.learner),{...input,p_identifier:'changed-synthetic@instapay'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const ownership=await f.evidence({purpose:'refund_destination_verification',parentType:'refund_destination',parentId:proposed.data.destination_id});
  const approval={p_destination_id:proposed.data.destination_id,p_evidence_file_id:ownership,p_decision:'verified',p_reason:'Independent synthetic source ownership evidence',p_expected_version:1,p_idempotency_key:randomUUID()};
  expect((await f.admin.rpc('verify_refund_destination',{...approval,p_validation_artifact_id:randomUUID()})).error).not.toBeNull();
  const verified=await admin.verify(await actor(f.admin),approval);expect(verified.data.verification_status).toBe('verified');
  expect((await admin.verify(await actor(f.admin),approval)).data).toEqual(verified.data);
  const projection=await f.rpc('list_refund_destinations',{p_refund_id:refund.refund_id,p_cursor:null,p_limit:25},f.learner);
  expect(JSON.stringify(projection)).not.toContain(input.p_identifier);expect(JSON.stringify(projection)).not.toMatch(/ciphertext|fingerprint|nonce|encrypted_identifier/);
  await expect(port.read(await actor(f.learner),proposed.data.destination_id,'verify_candidate',null,null)).rejects.toThrow('FORBIDDEN');
  await expect(worker.query('select * from finance_private.refund_destinations')).rejects.toThrow(/permission denied/);
 }finally{await worker.end();await f.close();}
});
