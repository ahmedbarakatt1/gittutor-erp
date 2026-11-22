import { createHash,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { SESv2Client,SendEmailCommand } from '@aws-sdk/client-sesv2';
import { z } from 'zod';
import { assertFakeProviderIsolation,isSafeFakeRecipient } from './fake-recipient';
export const emailObservationSchema=z.object({outcome:z.enum(['sent','delivered','failed','unknown','absent']),provider_message_id:z.string().max(300).nullable(),safe_error_code:z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable(),observed_at:z.iso.datetime({offset:true})}).strict();
export type EmailObservation=z.infer<typeof emailObservationSchema>;
export type EmailMessage={attempt_id:string;to:string;subject:string;text:string;html:string};
export type EmailAdapter={send(message:EmailMessage):Promise<EmailObservation>;reconcile(attemptId:string):Promise<EmailObservation>};
const result=(outcome:EmailObservation['outcome'],id:string|null=null,code:string|null=null):EmailObservation=>({outcome,provider_message_id:id,safe_error_code:code,observed_at:new Date().toISOString()});
export function createLocalEmailAdapter(directory:string,isolated:boolean,scenario:'success'|'timeout_after_success'|'transient_failure'|'permanent_failure'='success'):EmailAdapter{
 assertFakeProviderIsolation('FAKE_EMAIL_REQUIRES_ISOLATION',isolated);const root=resolve(directory);
 const path=(id:string)=>{if(!z.uuid().safeParse(id).success)throw new Error('EMAIL_IDENTITY_INVALID');return join(root,`${id}.json`);};
 async function read(id:string){try{return JSON.parse(await readFile(path(id),'utf8')) as {hash:string;message:EmailMessage;result:EmailObservation};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
 return {async send(message){if(!isSafeFakeRecipient(message.to))throw new Error('SYNTHETIC_EMAIL_REQUIRED');const hash=createHash('sha256').update(JSON.stringify(message)).digest('hex'),old=await read(message.attempt_id);if(old){if(old.hash!==hash)throw new Error('EMAIL_IDENTITY_CONFLICT');return emailObservationSchema.parse(old.result);}
  if(scenario==='transient_failure'||scenario==='permanent_failure')return result('failed',null,scenario==='transient_failure'?'EMAIL_TEMPORARY_REJECTION':'EMAIL_REJECTED');
  await mkdir(root,{recursive:true});const sent=result('sent',`fake:${message.attempt_id}`),target=path(message.attempt_id),temporary=`${target}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify({hash,message,result:sent}),{flag:'wx',mode:0o600});await rename(temporary,target);
  return scenario==='timeout_after_success'?result('unknown',null,'EMAIL_OUTCOME_UNKNOWN'):sent;
 },async reconcile(id){const existing=await read(id);return existing?emailObservationSchema.parse(existing.result):result('absent');}};
}
/** SDK retries are disabled: an ambiguous send must be reconciled through signed delivery events. */
export function createSesEmailAdapter(
  config: { region: string; from: string; configuration_set: string | null },
  client = new SESv2Client({ region: config.region, maxAttempts: 1 }),
): EmailAdapter {
  const from = z.email().safeParse(config.from).success ? `Git Tutor <${config.from}>` : config.from;
  return {
    async send(message) {
      const command = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        Content: { Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: message.html, Charset: 'UTF-8' },
          },
        } },
        EmailTags: [{ Name: 'git_tutor_attempt', Value: message.attempt_id }],
        ...(config.configuration_set && { ConfigurationSetName: config.configuration_set }),
      });
      try {
        const response = await client.send(command, { abortSignal: AbortSignal.timeout(10000) });
        if (response.MessageId) return result('sent', response.MessageId);
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'TooManyRequestsException') return result('failed', null, 'EMAIL_TEMPORARY_REJECTION');
        if (['MessageRejected', 'BadRequestException', 'MailFromDomainNotVerifiedException', 'AccountSuspendedException', 'SendingPausedException'].includes(name)) {
          return result('failed', null, 'EMAIL_REJECTED');
        }
      }
      return result('unknown', null, 'EMAIL_OUTCOME_UNKNOWN');
    },
    async reconcile() { return result('unknown', null, 'EMAIL_CALLBACK_REQUIRED'); },
  };
}

const resendReceipt = z.object({ id: z.uuid() });
const resendRejections = new Set([400, 401, 403, 404, 405, 413, 422]);

export function createResendEmailAdapter(config: { api_key: string; from: string }, fetcher: typeof fetch = fetch): EmailAdapter {
  return {
    async send({ attempt_id, to, subject, text, html }) {
      try {
        const response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${config.api_key}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `git-tutor/${attempt_id}`,
          },
          body: JSON.stringify({
            from: `Git Tutor <${config.from}>`,
            to: [to],
            subject,
            text,
            html,
            tags: [{ name: 'git_tutor_attempt', value: attempt_id }],
          }),
        });
        if (response.ok) {
          return result('sent', resendReceipt.parse(await response.json()).id);
        }
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 429) return result('failed', null, 'EMAIL_TEMPORARY_REJECTION');
        if (resendRejections.has(response.status)) return result('failed', null, 'EMAIL_REJECTED');
      } catch {
        // A transport or response parsing error can follow a successful send.
      }
      return result('unknown', null, 'EMAIL_OUTCOME_UNKNOWN');
    },
    async reconcile() {
      // The send-only key cannot look up this attempt. Wait for a signed
      // callback instead of replaying a send with a 24-hour idempotency key.
      return result('unknown', null, 'EMAIL_CALLBACK_REQUIRED');
    },
  };
}
