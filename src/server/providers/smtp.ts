import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer/lib/mailer';
import type { SMTPSentMessageInfo, SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { z } from 'zod';
import type { EmailAdapter, EmailObservation } from './email';

export type SmtpSender = {
  sendMail(options: SendMailOptions): Promise<Pick<SMTPSentMessageInfo, 'accepted' | 'rejected'>>;
};
type SmtpConfig = {
  host: string;
  auth: { user: string; pass: string };
  from: string;
  headers?: (attemptId: string) => Record<string, string>;
};

export function smtpTransportOptions({ host, auth }: SmtpConfig): SMTPTransportOptions {
  return {
    host, port: 465, secure: true, pool: false, auth,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: host },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
}

function observation(outcome: EmailObservation['outcome'], id: string | null, code: string | null): EmailObservation {
  return { outcome, provider_message_id: id, safe_error_code: code, observed_at: new Date().toISOString() };
}

const smtpError = z.object({ responseCode: z.number().int().optional(), code: z.string().optional() });

export function createSmtpEmailAdapter(config: SmtpConfig, sender: SmtpSender = nodemailer.createTransport(smtpTransportOptions(config))): EmailAdapter {
  return {
    async send({ attempt_id, to, subject, text, html }) {
      if (!z.uuid().safeParse(attempt_id).success || !z.email().safeParse(to).success) {
        return observation('failed', null, 'EMAIL_REJECTED');
      }
      // A stable Message-ID lets an operator find an uncertain send before attempting a retry.
      const messageId = `<git-tutor.${attempt_id}@${config.from.split('@')[1]}>`;
      try {
        const sent = await sender.sendMail({
          from: { name: 'Git Tutor', address: config.from }, to, subject, text, html, messageId,
          envelope: { from: config.from, to: [to] }, disableFileAccess: true, disableUrlAccess: true,
          ...(config.headers && { headers: config.headers(attempt_id) }),
        });
        if (sent.accepted.length === 1 && sent.accepted[0] === to && sent.rejected.length === 0) {
          return observation('sent', messageId, null);
        }
      } catch (error) {
        const response = smtpError.safeParse(error);
        if (response.success) {
          const { responseCode: status, code } = response.data;
          if (status && status >= 400 && status < 500) return observation('failed', null, 'EMAIL_TEMPORARY_REJECTION');
          if ((status && status >= 500 && status < 600) || code === 'EAUTH' || code === 'EENVELOPE') {
            return observation('failed', null, 'EMAIL_REJECTED');
          }
        }
      }
      return observation('unknown', null, 'EMAIL_OUTCOME_UNKNOWN');
    },
    async reconcile() { return observation('unknown', null, 'EMAIL_MANUAL_RECONCILIATION_REQUIRED'); },
  };
}
