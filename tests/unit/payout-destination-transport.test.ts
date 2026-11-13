import{randomUUID}from'node:crypto';
import{expect,test,vi}from'vitest';
vi.mock('server-only',()=>({}));
import{createIdentifierCipher}from'../../src/server/private-identifiers';
import{createPayoutDestinationTransport,validatePayoutIdentifier,type PrivatePayoutDestinationPort}from'../../src/server/payout-destination-transport';

test('payout identifier syntax rejects invalid mobile/account values before encrypting or verifying',()=>{
 expect(validatePayoutIdentifier('instapay',' synthetic.tutor@instapay ')).toBe('synthetic.tutor@instapay');
 expect(validatePayoutIdentifier('vodafone_cash','+201508823452')).toBe('+201508823452');
 for(const value of['+20150882345','+20208823452','+2015088234520','arbitrary','+2015\u202e08823452'])expect(()=>validatePayoutIdentifier('vodafone_cash',value)).toThrow();
 for(const value of['x@example.test','@instapay','x y@instapay','a\n@instapay'])expect(()=>validatePayoutIdentifier('instapay',value)).toThrow();
});
test('payout transport preserves ciphertext replay and validates authenticated identity before verification',async()=>{
 const actor={account_id:randomUUID(),session_id:randomUUID()},tutorId=randomUUID(),cipher=createIdentifierCipher({currentKeyId:'synthetic',currentKey:'a'.repeat(64)});
 let prior:Record<string,unknown>|null=null;
 const prepare=vi.fn(async()=>({tutor_id:tutorId,owner_account_id:actor.account_id,prior_request:prior})),read=vi.fn<PrivatePayoutDestinationPort['read']>(),issue=vi.fn<PrivatePayoutDestinationPort['issue']>();
 const rpc=vi.fn(async(name:string,args?:Record<string,unknown>):Promise<{data:unknown;status:number;error:null}>=>{if(name!=='submit_payout_destination'||!args)throw Error('unexpected');prior=args;return{data:{command_id:randomUUID(),resource_id:args.p_destination_id,destination_id:args.p_destination_id,version:1,masked_identifier:args.p_masked_identifier,verification_status:'unverified'},status:201,error:null};});
 const transport=createPayoutDestinationTransport({cipher,client:{rpc},port:{prepare,read,issue}}),request={p_channel:'instapay',p_identifier:'synthetic.tutor@instapay',p_payee_name:'Synthetic Tutor',p_idempotency_key:randomUUID()};
 const result=await transport.submit(actor,request),original=(structuredClone(prior) as Record<string,unknown>|null)!;expect(JSON.stringify(rpc.mock.calls)).not.toContain(request.p_identifier);expect(JSON.stringify(result)).not.toMatch(/encrypted_identifier|fingerprint/);
 await transport.submit(actor,{...request,p_identifier:` ${request.p_identifier} `});expect(rpc.mock.calls[1][1]).toEqual(original);
 await expect(transport.submit(actor,{...request,p_identifier:'other@instapay'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 const row={destination_id:original.p_destination_id,tutor_id:tutorId,owner_account_id:actor.account_id,channel:'instapay',identifier_version:1,version:1,encrypted_identifier:original.p_encrypted_identifier,ciphertext_digest:'b'.repeat(64),masked_identifier:original.p_masked_identifier,identifier_fingerprint:original.p_identifier_fingerprint,verification_status:'unverified',destination_version_id:null};
 const approval={p_destination_id:row.destination_id,p_expected_version:1,p_evidence_file_id:randomUUID(),p_decision:'verified',p_reason:'Synthetic independently checked identity',p_idempotency_key:randomUUID()};
 read.mockResolvedValueOnce({...row,tutor_id:randomUUID()});await expect(transport.verify(actor,approval)).rejects.toThrow('PRIVATE_IDENTIFIER_UNAVAILABLE');expect(issue).not.toHaveBeenCalled();
 read.mockResolvedValueOnce(row);issue.mockResolvedValueOnce({validation_artifact_id:randomUUID(),approval_request_hash:'c'.repeat(64),expires_at:new Date(Date.now()+60000).toISOString()});
 rpc.mockImplementationOnce(async()=>({data:{command_id:randomUUID(),resource_id:row.destination_id,version:2,destination_version_id:randomUUID(),verification_status:'verified'},status:200,error:null}));await transport.verify(actor,approval);
 expect(issue).toHaveBeenCalledWith(actor,expect.objectContaining({destination_id:row.destination_id,destination_version:1,purpose:'verify_payout_destination',approval_request:expect.objectContaining({evidence_file_id:approval.p_evidence_file_id,idempotency_key:approval.p_idempotency_key})}));
});
