import { createSmtpEmailAdapter, smtpTransportOptions, type SmtpSender } from './smtp';

type GmailConfig = { user: string; app_password: string };

function settings({ user, app_password }: GmailConfig) {
  return { host: 'smtp.gmail.com', auth: { user, pass: app_password }, from: user };
}

export function gmailTransportOptions(config: GmailConfig) {
  return smtpTransportOptions(settings(config));
}

export function createGmailEmailAdapter(config: GmailConfig, sender?: SmtpSender) {
  return createSmtpEmailAdapter(settings(config), sender);
}
