import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {z} from 'zod';

export const whatsappObservation=z.object({outcome:z.enum(['sent','delivered','read','failed','unknown','absent']),provider_message_id:z.string().max(300).nullable(),safe_error_code:z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable()}).strict();
export type WhatsAppObservation=z.infer<typeof whatsappObservation>;
export type WhatsAppMessage={message_id:string;destination:string;text:string|null;template:{name:string;language:string;parameters:string[]}|null};
export type WhatsAppAdapter={send(message:WhatsAppMessage):Promise<WhatsAppObservation>;reconcile(id:string):Promise<WhatsAppObservation>};
export type WhatsAppScenario='success'|'timeout_after_success'|'failure';
const observation=(outcome:WhatsAppObservation['outcome'],provider_message_id:string|null=null,safe_error_code:string|null=null):WhatsAppObservation=>({outcome,provider_message_id,safe_error_code});
export function parseWhatsAppConfig(raw:Record<string,string|undefined>,isolated:boolean){
 const mode=z.enum(['fake','cloud']).parse(raw.WHATSAPP_ADAPTER||'fake');if(mode==='fake'&&!isolated)throw Error('FAKE_WHATSAPP_REQUIRES_ISOLATION');
 const config={mode,isolated,business_account_id:raw.WHATSAPP_BUSINESS_ACCOUNT_ID||'',phone_number_id:raw.WHATSAPP_PHONE_NUMBER_ID||'',access_token:raw.WHATSAPP_ACCESS_TOKEN||'',app_secret:raw.WHATSAPP_APP_SECRET||'',verify_token:raw.WHATSAPP_VERIFY_TOKEN||'',graph_version:raw.WHATSAPP_GRAPH_VERSION||''};
 if(mode==='cloud'&&(!Object.entries(config).every(([k,v])=>k==='isolated'||Boolean(v))||!/^v\d{2,3}\.\d+$/.test(config.graph_version)||!/^\d+$/.test(config.phone_number_id)||!/^\d+$/.test(config.business_account_id)))throw Error('WHATSAPP_CONFIGURATION_REQUIRED');return config;
}
export function createWhatsAppAdapter(config:ReturnType<typeof parseWhatsAppConfig>,scenario:WhatsAppScenario='success'){return config.mode==='cloud'?createCloudWhatsAppAdapter(config):createFakeWhatsAppAdapter('.local/whatsapp-inbox',config.isolated,scenario);}
export function createFakeWhatsAppAdapter(directory:string,isolated:boolean,scenario:WhatsAppScenario='success'):WhatsAppAdapter{
 if(!isolated)throw Error('FAKE_WHATSAPP_REQUIRES_ISOLATION');const root=resolve(directory),path=(id:string)=>join(root,`${z.uuid().parse(id)}.json`);
 async function read(id:string){try{return JSON.parse(await readFile(path(id),'utf8')) as {hash:string;result:WhatsAppObservation};}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
 return {async send(message){const hash=createHash('sha256').update(JSON.stringify(message)).digest('hex'),prior=await read(message.message_id);if(prior){if(prior.hash!==hash)throw Error('WHATSAPP_IDENTITY_CONFLICT');return whatsappObservation.parse(prior.result);}if(scenario==='failure')return observation('failed',null,'WHATSAPP_REJECTED');await mkdir(root,{recursive:true});const result=observation('sent',`fake:${message.message_id}`),target=path(message.message_id),temporary=`${target}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify({hash,message,result}),{flag:'wx',mode:0o600});await rename(temporary,target);return scenario==='timeout_after_success'?observation('unknown',null,'WHATSAPP_OUTCOME_UNKNOWN'):result;},async reconcile(id){const prior=await read(id);return prior?whatsappObservation.parse(prior.result):observation('absent');}};
}
/** No transport retries. The signed callback correlation is the recovery path for ambiguous sends. */
export function createCloudWhatsAppAdapter(config:{phone_number_id:string;access_token:string;graph_version:string},fetcher:typeof fetch=fetch):WhatsAppAdapter{
 return {async send(message){const body={messaging_product:'whatsapp',recipient_type:'individual',to:message.destination,biz_opaque_callback_data:message.message_id,...(message.template?{type:'template',template:{name:message.template.name,language:{code:message.template.language},...(message.template.parameters.length?{components:[{type:'body',parameters:message.template.parameters.map(text=>({type:'text',text}))}]}:{})}}:{type:'text',text:{preview_url:false,body:message.text}})};
  try{const response=await fetcher(`https://graph.facebook.com/${config.graph_version}/${config.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${config.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)return response.status>=400&&response.status<500?observation('failed',null,'WHATSAPP_REJECTED'):observation('unknown',null,'WHATSAPP_OUTCOME_UNKNOWN');const data=z.object({messages:z.array(z.object({id:z.string().min(1).max(300)})).min(1)}).parse(await response.json());return observation('sent',data.messages[0].id);}catch{return observation('unknown',null,'WHATSAPP_OUTCOME_UNKNOWN');}},async reconcile(){return observation('unknown',null,'WHATSAPP_CALLBACK_REQUIRED');}};
}
