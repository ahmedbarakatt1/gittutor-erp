import nodemailer from 'nodemailer';
import type {SMTPTransportOptions,SMTPSentMessageInfo} from 'nodemailer/lib/smtp-transport';
import type {SendMailOptions} from 'nodemailer/lib/mailer';
import {z} from 'zod';
import type {EmailAdapter,EmailObservation} from './email';

type MailjetConfig={from:string;api_key:string;secret_key:string};
type Sender={sendMail(options:SendMailOptions):Promise<Pick<SMTPSentMessageInfo,'accepted'|'rejected'>>};
const observation=(outcome:EmailObservation['outcome'],id:string|null=null,code:string|null=null):EmailObservation=>({outcome,provider_message_id:id,safe_error_code:code,observed_at:new Date().toISOString()});

export function mailjetTransportOptions(config:MailjetConfig):SMTPTransportOptions {
 return {host:'in-v3.mailjet.com',port:465,secure:true,pool:false,
  auth:{user:config.api_key,pass:config.secret_key},
  tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,servername:'in-v3.mailjet.com'},
  connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
  logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true};
}

/** SMTP acceptance is not delivery. Uncertain sends require evidence before any retry. */
export function createMailjetEmailAdapter(config:MailjetConfig,sender:Sender=nodemailer.createTransport(mailjetTransportOptions(config))):EmailAdapter {
 return {
  async send({attempt_id,to,subject,text,html}){
   if(!z.uuid().safeParse(attempt_id).success||!z.email().safeParse(to).success)return observation('failed',null,'EMAIL_REJECTED');
   const messageId=`<git-tutor.${attempt_id}@${config.from.split('@')[1]}>`;
   try{
    const sent=await sender.sendMail({from:config.from,to,subject,text,html,messageId,
     envelope:{from:config.from,to:[to]},disableFileAccess:true,disableUrlAccess:true,
     // The attempt identifier is for investigation, not a send-idempotency guarantee.
     headers:{'X-MJ-CustomID':attempt_id,'X-Mailjet-TrackOpen':'0','X-Mailjet-TrackClick':'0'}});
    if(sent.accepted.length===1&&sent.accepted[0]===to&&sent.rejected.length===0)return observation('sent',messageId);
   }catch(error){
    const response=z.object({responseCode:z.number().int().optional(),code:z.string().optional()}).safeParse(error);
    if(response.success){
     const status=response.data.responseCode;
     if(status&&status>=400&&status<500)return observation('failed',null,'EMAIL_TEMPORARY_REJECTION');
     if((status&&status>=500&&status<600)||['EAUTH','EENVELOPE'].includes(response.data.code||''))return observation('failed',null,'EMAIL_REJECTED');
    }
   }
   return observation('unknown',null,'EMAIL_OUTCOME_UNKNOWN');
  },
  // No callback is trusted until a separately authenticated Mailjet receiver is implemented.
  async reconcile(){return observation('unknown',null,'EMAIL_MANUAL_RECONCILIATION_REQUIRED');},
 };
}
