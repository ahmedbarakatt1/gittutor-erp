import {describe,expect,it,vi} from 'vitest';
import nodemailer from 'nodemailer';
import {parseServerConfig,publicConfig} from '@/server/config';

const env={APP_ENV:'development',EMAIL_ADAPTER:'mailjet',EMAIL_FROM:'sender@gmail.com',MAILJET_API_KEY:'a'.repeat(32),MAILJET_SECRET_KEY:'b'.repeat(32)};
const config={from:env.EMAIL_FROM,api_key:env.MAILJET_API_KEY,secret_key:env.MAILJET_SECRET_KEY};
const message={attempt_id:'a9c0e8c3-d0cf-456b-bf06-2b3039d76675',to:'learner@example.test',subject:'Your session',text:'Review your booking.',html:'<p>Review your booking.</p>'};

describe('Mailjet SMTP',()=>{
 it('requires private credentials and a single sender while preserving the fake default',()=>{
  const server=parseServerConfig(env);
  expect(server.mailjet).toEqual(config);
  expect(publicConfig(server)).toEqual({supabase_url:null,supabase_publishable_key:null});
  expect(server.gmail).toBeNull();expect(server.resend).toBeNull();
  for(const key of ['EMAIL_FROM','MAILJET_API_KEY','MAILJET_SECRET_KEY'])expect(()=>parseServerConfig({...env,[key]:''})).toThrow(key);
  for(const from of ['a@example.test,b@example.test','sender@example.test\r\nBcc: hidden@example.test'])expect(()=>parseServerConfig({...env,EMAIL_FROM:from})).toThrow('EMAIL_FROM');
  expect(()=>parseServerConfig({...env,MAILJET_SECRET_KEY:'secret\r\nINJECTION'})).toThrow('MAILJET_SECRET_KEY');
  expect(parseServerConfig({...env,EMAIL_ADAPTER:'fake'}).mailjet).toBeNull();
  expect(parseServerConfig({}).providers.email).toBe('fake');
 });
 it('uses fixed certificate-validated TLS and keeps SMTP credentials out of logs',async()=>{
  const {mailjetTransportOptions}=await import('@/server/providers/mailjet');
  expect(mailjetTransportOptions(config)).toMatchObject({host:'in-v3.mailjet.com',port:465,secure:true,pool:false,auth:{user:config.api_key,pass:config.secret_key},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,servername:'in-v3.mailjet.com'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
 });
 it('produces one private customer message with tracking disabled and no arbitrary fields',async()=>{
  const {createMailjetEmailAdapter}=await import('@/server/providers/mailjet');
  const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  let wire='';let envelope:unknown;
  const adapter=createMailjetEmailAdapter(config,{async sendMail(options){
   const output=await stream.sendMail(options);wire=output.message.toString();envelope=output.envelope;
   return {accepted:[message.to],rejected:[]};
  }});
  const extra={...message,tutor_fee_minor:12345,internal_notes:'PRIVATE_NOTE',attachments:[{path:'/private/COMPENSATION'}],bcc:'hidden@example.test',headers:{'X-Mailjet-TrackClick':'1','X-Private':'PRIVATE_NOTE'}};
  expect(await adapter.send(extra)).toMatchObject({outcome:'sent',provider_message_id:'<git-tutor.a9c0e8c3-d0cf-456b-bf06-2b3039d76675@gmail.com>',safe_error_code:null});
  expect(envelope).toEqual({from:'sender@gmail.com',to:['learner@example.test']});
  expect(wire).toMatch(/^X-Mailjet-TrackOpen: 0\r?$/im);expect(wire).toMatch(/^X-Mailjet-TrackClick: 0\r?$/im);
  expect(wire).toMatch(/^X-MJ-CustomID: a9c0e8c3-d0cf-456b-bf06-2b3039d76675\r?$/im);
  expect(wire).not.toMatch(/PRIVATE_NOTE|COMPENSATION|12345|hidden@example|\nBcc:|\nCc:|Content-Disposition: attachment/);
 });
 it.each([[{responseCode:450},'failed','EMAIL_TEMPORARY_REJECTION'],[{responseCode:550},'failed','EMAIL_REJECTED'],[{code:'EAUTH'},'failed','EMAIL_REJECTED'],[{code:'ETIMEDOUT'},'unknown','EMAIL_OUTCOME_UNKNOWN'],[{code:'ECONNRESET'},'unknown','EMAIL_OUTCOME_UNKNOWN']])('keeps safe outcome %j without automatic replay',async(error,outcome,code)=>{
  const {createMailjetEmailAdapter}=await import('@/server/providers/mailjet');
  const sendMail=vi.fn().mockRejectedValue({...error,message:'PRIVATE_SMTP_DIAGNOSTIC'});
  const adapter=createMailjetEmailAdapter(config,{sendMail});
  expect(await adapter.send(message)).toEqual({outcome,provider_message_id:null,safe_error_code:code,observed_at:expect.any(String)});
  expect(await adapter.reconcile(message.attempt_id)).toMatchObject({outcome:'unknown',safe_error_code:'EMAIL_MANUAL_RECONCILIATION_REQUIRED'});
  expect(sendMail).toHaveBeenCalledTimes(1);
 });
 it('does not dispatch malformed identities and preserves ambiguous receipts',async()=>{
  const {createMailjetEmailAdapter}=await import('@/server/providers/mailjet');
  const sendMail=vi.fn().mockResolvedValue({accepted:[],rejected:[]});
  const adapter=createMailjetEmailAdapter(config,{sendMail});
  for(const changed of [{attempt_id:'bad\r\nBcc: hidden@example.test'},{to:'one@example.test,two@example.test'}])expect(await adapter.send({...message,...changed})).toMatchObject({outcome:'failed',safe_error_code:'EMAIL_REJECTED'});
  expect(sendMail).not.toHaveBeenCalled();
  expect(await adapter.send(message)).toMatchObject({outcome:'unknown',safe_error_code:'EMAIL_OUTCOME_UNKNOWN'});
  expect(sendMail).toHaveBeenCalledTimes(1);
 });
});
