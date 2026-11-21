import { createSmtpEmailAdapter, smtpTransportOptions, type SmtpSender } from './smtp';

type MailjetConfig = { from: string; api_key: string; secret_key: string };

function settings({ from, api_key, secret_key }: MailjetConfig) {
  return {
    host: 'in-v3.mailjet.com', auth: { user: api_key, pass: secret_key }, from,
    headers: (attemptId: string) => ({
      'X-MJ-CustomID': attemptId, 'X-Mailjet-TrackOpen': '0', 'X-Mailjet-TrackClick': '0',
    }),
  };
}

export function mailjetTransportOptions(config: MailjetConfig) {
  return smtpTransportOptions(settings(config));
}

export function createMailjetEmailAdapter(config: MailjetConfig, sender?: SmtpSender) {
  return createSmtpEmailAdapter(settings(config), sender);
}
