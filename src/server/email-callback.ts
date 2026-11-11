import 'server-only';
import { X509Certificate,createVerify } from 'node:crypto';
import { z } from 'zod';
const snsSchema=z.object({Type:z.enum(['Notification','SubscriptionConfirmation','UnsubscribeConfirmation']),MessageId:z.uuid(),TopicArn:z.string().max(500),Message:z.string().max(65536),Timestamp:z.iso.datetime({offset:true}),SignatureVersion:z.enum(['1','2']),Signature:z.string().min(1).max(2048),SigningCertURL:z.url().max(500),Subject:z.string().max(200).optional(),Token:z.string().max(4096).optional(),SubscribeURL:z.url().max(4096).optional(),UnsubscribeURL:z.url().max(4096).optional()}).strict();
export function snsStringToSign(value:z.infer<typeof snsSchema>){const fields=value.Type==='Notification'?['Message','MessageId',...(value.Subject===undefined?[]:['Subject']),'Timestamp','TopicArn','Type']:['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type'];return fields.map(key=>`${key}\n${value[key as keyof typeof value]}\n`).join('');}
const certificateCache=new Map<string,{certificate:X509Certificate;expires:number}>();
async function boundedBody(response:Response,limit:number){const reader=response.body?.getReader();if(!reader)throw new Error('EMAIL_CALLBACK_INVALID');const chunks:Uint8Array[]=[];let length=0;for(;;){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>limit){await reader.cancel();throw new Error('EMAIL_CALLBACK_INVALID');}chunks.push(item.value);}return Buffer.concat(chunks).toString('utf8');}
export async function verifyEmailCallback(input:unknown,config:{region:string;topic_arn:string},fetcher:typeof fetch=fetch){
 const value=snsSchema.parse(input);if(value.TopicArn!==config.topic_arn||Date.parse(value.Timestamp)>Date.now()+300000)throw new Error('EMAIL_CALLBACK_INVALID');
 const url=new URL(value.SigningCertURL);if(url.protocol!=='https:'||url.hostname!==`sns.${config.region}.amazonaws.com`||url.port||url.username||url.password||url.search||url.hash||!/^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/.test(url.pathname))throw new Error('EMAIL_CALLBACK_INVALID');
 let cert=certificateCache.get(url.href);if(!cert||cert.expires<=Date.now()){
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('EMAIL_CALLBACK_INVALID');const certificate=new X509Certificate(await boundedBody(response,16384));
  if(Date.parse(certificate.validFrom)>Date.now()||Date.parse(certificate.validTo)<Date.now()||certificate.publicKey.asymmetricKeyType!=='rsa')throw new Error('EMAIL_CALLBACK_INVALID');
  if(certificateCache.size>=8)certificateCache.delete(certificateCache.keys().next().value!);cert={certificate,expires:Math.min(Date.now()+3600000,Date.parse(certificate.validTo))};certificateCache.set(url.href,cert);
 }
 const signature=Buffer.from(value.Signature,'base64');if(signature.toString('base64')!==value.Signature)throw new Error('EMAIL_CALLBACK_INVALID');const verifier=createVerify(value.SignatureVersion==='2'?'RSA-SHA256':'RSA-SHA1');verifier.update(snsStringToSign(value));verifier.end();if(!verifier.verify(cert.certificate.publicKey,signature))throw new Error('EMAIL_CALLBACK_INVALID');
 if(value.Type!=='Notification')return {kind:'subscription' as const};
 const message=z.object({eventType:z.string().optional(),notificationType:z.string().optional(),mail:z.object({messageId:z.string().min(1).max(300),timestamp:z.iso.datetime({offset:true}),tags:z.record(z.string(),z.array(z.string())).optional()}).passthrough()}).passthrough().parse(JSON.parse(value.Message));
 const attempt=z.uuid().parse(message.mail.tags?.git_tutor_attempt?.[0]);const event=message.eventType??message.notificationType;const outcome=event==='Delivery'?'delivered':event==='Bounce'||event==='Complaint'?'bounced':event==='Send'?'sent':event==='Reject'||event==='Rendering Failure'?'failed':null;
 return outcome?{kind:'observation' as const,attempt_id:attempt,provider_message_id:message.mail.messageId,callback_id:value.MessageId,outcome,observed_at:value.Timestamp}:{kind:'ignored' as const};
}
