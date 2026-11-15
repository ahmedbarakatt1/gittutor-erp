import nodemailer from 'nodemailer';
import type {SMTPTransportOptions,SMTPSentMessageInfo} from 'nodemailer/lib/smtp-transport';
import type {SendMailOptions} from 'nodemailer/lib/mailer';
import {z} from 'zod';
import type {EmailAdapter,EmailObservation} from './email';

type GmailConfig={user:string;app_password:string};
type Sender={sendMail(options:SendMailOptions):Promise<Pick<SMTPSentMessageInfo,'accepted'|'rejected'>>};
const observation=(outcome:EmailObservation['outcome'],id:string|null=null,code:string|null=null):EmailObservation=>({outcome,provider_message_id:id,safe_error_code:code,observed_at:new Date().toISOString()});

export function gmailTransportOptions(config:GmailConfig):SMTPTransportOptions {
  return {host:'smtp.gmail.com',port:465,secure:true,pool:false,
    auth:{user:config.user,pass:config.app_password},
    tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,servername:'smtp.gmail.com'},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
    logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true};
}

/** SMTP has no send-idempotency or signed delivery callback. Never replay an uncertain send. */
export function createGmailEmailAdapter(config:GmailConfig,sender:Sender=nodemailer.createTransport(gmailTransportOptions(config))):EmailAdapter {
  return {
    async send({attempt_id,to,subject,text,html}){
      if(!z.uuid().safeParse(attempt_id).success||!z.email().safeParse(to).success)return observation('failed',null,'EMAIL_REJECTED');
      // Stable searchable identity for operator reconciliation, not a deduplication guarantee.
      const messageId=`<git-tutor.${attempt_id}@gmail.com>`;
      try{
        const sent=await sender.sendMail({from:config.user,to,subject,text,html,messageId,
          envelope:{from:config.user,to:[to]},disableFileAccess:true,disableUrlAccess:true});
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
    async reconcile(){return observation('unknown',null,'EMAIL_MANUAL_RECONCILIATION_REQUIRED');},
  };
}
