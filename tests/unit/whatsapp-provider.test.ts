import {createHmac,randomUUID} from 'node:crypto';
import {mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {parseWhatsAppWebhook,verifyWhatsAppSignature} from '../../src/server/whatsapp-webhook';
import {createFakeWhatsAppAdapter,createCloudWhatsAppAdapter,parseWhatsAppConfig} from '../../src/server/providers/whatsapp';

test('WhatsApp authenticates exact raw bytes and accepts only the configured provider channel',()=>{
 const value={object:'whatsapp_business_account',entry:[{id:'business1',changes:[{field:'messages',value:{metadata:{phone_number_id:'phone1'},messages:[{id:'wamid.1',from:'201234567890',timestamp:'1794560400',type:'text',text:{body:'booking'}}]}}]}]};
 const raw=Buffer.from(JSON.stringify(value)),signature='sha256='+createHmac('sha256','secret').update(raw).digest('hex');
 expect(verifyWhatsAppSignature(raw,signature,'secret')).toBe(true);expect(verifyWhatsAppSignature(Buffer.concat([raw,Buffer.from(' ')]),signature,'secret')).toBe(false);expect(verifyWhatsAppSignature(raw,'sha256=00','secret')).toBe(false);
 expect(parseWhatsAppWebhook(raw,{business_account_id:'business1',phone_number_id:'phone1'})).toEqual([expect.objectContaining({kind:'message',provider_message_id:'wamid.1',text:'booking',wa_id:'201234567890'})]);
 expect(()=>parseWhatsAppWebhook(raw,{business_account_id:'other',phone_number_id:'phone1'})).toThrow();
});
test('fake WhatsApp recovers a lost acknowledgement without creating a second send',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'git-tutor-wa-')),adapter=createFakeWhatsAppAdapter(directory,true,'timeout_after_success');const request={message_id:randomUUID(),destination:'201234567890',text:'Synthetic reply',template:null};
 expect((await adapter.send(request)).outcome).toBe('unknown');expect((await adapter.reconcile(request.message_id)).outcome).toBe('sent');expect((await adapter.send(request)).outcome).toBe('sent');expect(await readdir(directory)).toHaveLength(1);
 expect(()=>createFakeWhatsAppAdapter(directory,false)).toThrow('FAKE_WHATSAPP_REQUIRES_ISOLATION');
});
test('live WhatsApp sends one correlated request and preserves ambiguous transport outcomes',async()=>{
 const calls:RequestInit[]=[],adapter=createCloudWhatsAppAdapter({phone_number_id:'123',access_token:'synthetic-secret',graph_version:'v25.0'},async(_url,init)=>{calls.push(init!);return new Response(JSON.stringify({messages:[{id:'wamid.sent'}]}));});
 const id=randomUUID();expect((await adapter.send({message_id:id,destination:'201234567890',text:null,template:{name:'support_followup',language:'en',parameters:['test']}})).outcome).toBe('sent');expect(calls).toHaveLength(1);expect(JSON.parse(String(calls[0].body))).toMatchObject({biz_opaque_callback_data:id,type:'template',template:{name:'support_followup'}});
 const unknown=createCloudWhatsAppAdapter({phone_number_id:'123',access_token:'synthetic-secret',graph_version:'v25.0'},async()=>{throw new Error('timeout');});expect((await unknown.send({message_id:id,destination:'201234567890',text:'Hello',template:null})).outcome).toBe('unknown');expect((await unknown.reconcile(id)).outcome).toBe('unknown');
 expect(()=>parseWhatsAppConfig({WHATSAPP_ADAPTER:'cloud'},false)).toThrow();
});
