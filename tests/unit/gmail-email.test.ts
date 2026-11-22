import {describe,expect,it,vi} from 'vitest';
import {createGmailEmailAdapter,gmailTransportOptions} from '@/server/providers/gmail';
import {parseServerConfig,publicConfig} from '@/server/config';

const config={user:'sender@gmail.com',app_password:'abcdefghijklmnop'};
const message={attempt_id:'a9c0e8c3-d0cf-456b-bf06-2b3039d76675',to:'learner@example.test',subject:'Your session',text:'Review your booking.',html:'<p>Review your booking.</p>',tutor_fee_minor:12345,attachments:[{path:'/private/data'}],bcc:'private@example.test'};
describe('Gmail SMTP',()=>{
 it('uses validated TLS on the fixed Gmail endpoint without logging or reading files/URLs',()=>{
  expect(gmailTransportOptions(config)).toEqual({host:'smtp.gmail.com',port:465,secure:true,pool:false,auth:{user:config.user,pass:config.app_password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,servername:'smtp.gmail.com'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
 });
 it('sends only one allowed customer envelope and reports SMTP acceptance, not delivery',async()=>{
  const sendMail=vi.fn().mockResolvedValue({accepted:[message.to],rejected:[],messageId:'<server-id@gmail.com>'});
  const adapter=createGmailEmailAdapter(config,{sendMail});
  expect(await adapter.send(message)).toMatchObject({outcome:'sent',provider_message_id:`<git-tutor.${message.attempt_id}@gmail.com>`,safe_error_code:null});
  expect(sendMail).toHaveBeenCalledExactlyOnceWith({from:{name:'Git Tutor',address:config.user},to:message.to,subject:message.subject,text:message.text,html:message.html,messageId:`<git-tutor.${message.attempt_id}@gmail.com>`,envelope:{from:config.user,to:[message.to]},disableFileAccess:true,disableUrlAccess:true});
 });
 it.each([[{responseCode:450},'failed','EMAIL_TEMPORARY_REJECTION'],[{responseCode:550},'failed','EMAIL_REJECTED'],[{code:'EAUTH'},'failed','EMAIL_REJECTED'],[{code:'ETIMEDOUT'},'unknown','EMAIL_OUTCOME_UNKNOWN'],[{code:'ECONNRESET'},'unknown','EMAIL_OUTCOME_UNKNOWN']])('keeps safe outcome %j without retry or provider details',async(error,outcome,code)=>{
  const sendMail=vi.fn().mockRejectedValue({...error,message:'private provider/credential diagnostics'});
  expect(await createGmailEmailAdapter(config,{sendMail}).send(message)).toEqual({outcome,provider_message_id:null,safe_error_code:code,observed_at:expect.any(String)});
  expect(sendMail).toHaveBeenCalledTimes(1);
 });
 it('keeps missing acceptance and reconciliation unknown without resending',async()=>{
  const sendMail=vi.fn().mockResolvedValue({accepted:[],rejected:[]});
  const adapter=createGmailEmailAdapter(config,{sendMail});
  expect(await adapter.send(message)).toMatchObject({outcome:'unknown'});
  expect(await adapter.reconcile(message.attempt_id)).toMatchObject({outcome:'unknown',safe_error_code:'EMAIL_MANUAL_RECONCILIATION_REQUIRED'});
  expect(sendMail).toHaveBeenCalledTimes(1);
 });
 it('rejects an invalid attempt or multiple-address input before network dispatch',async()=>{
  const sendMail=vi.fn();const adapter=createGmailEmailAdapter(config,{sendMail});
  for(const changed of [{attempt_id:'bad\r\nBcc: hidden@example.test'},{to:'one@example.test,two@example.test'}])expect(await adapter.send({...message,...changed})).toMatchObject({outcome:'failed',safe_error_code:'EMAIL_REJECTED'});
  expect(sendMail).not.toHaveBeenCalled();
 });
 it('requires private App Password configuration and excludes it from public settings',()=>{
  const env={APP_ENV:'development',EMAIL_ADAPTER:'gmail',GMAIL_SMTP_USER:config.user,GMAIL_APP_PASSWORD:'abcd efgh ijkl mnop'};
  const server=parseServerConfig(env);expect(server.gmail).toEqual(config);expect(server.resend).toBeNull();
  expect(publicConfig(server)).toEqual({supabase_url:null,supabase_publishable_key:null});
  for(const key of ['GMAIL_SMTP_USER','GMAIL_APP_PASSWORD'])expect(()=>parseServerConfig({...env,[key]:''})).toThrow(key);
  expect(()=>parseServerConfig({...env,GMAIL_SMTP_USER:'sender@another.example'})).toThrow('GMAIL_SMTP_USER');
  expect(()=>parseServerConfig({...env,GMAIL_APP_PASSWORD:'not-an-app-password'})).toThrow('GMAIL_APP_PASSWORD');
  expect(parseServerConfig({...env,EMAIL_ADAPTER:'fake'}).gmail).toBeNull();
 });
});
