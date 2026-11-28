import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { expect, test, vi } from 'vitest';
import { createSesEmailAdapter } from '@/server/providers/email';
import { renderNotification } from '@/modules/notifications/templates';

test.each([
  ['notices@example.test', 'Git Tutor <notices@example.test>'],
  ['Tutoring office <notices@example.test>', 'Tutoring office <notices@example.test>'],
])('SES retains the verified address and sends both Arabic parts as UTF-8', async (from, expectedFrom) => {
  const client = new SESv2Client({ region: 'us-east-1', maxAttempts: 1 });
  const send = vi.spyOn(client, 'send').mockImplementation(async () => ({ MessageId: 'synthetic-message' }));
  const message = {
    attempt_id: 'a9c0e8c3-d0cf-456b-bf06-2b3039d76675',
    to: 'learner@example.test',
    ...renderNotification({ locale: 'ar', kind: 'session', audience: 'customer', action_path: '/learn/bookings', starts_at: null }, 'https://portal.example.test'),
  };
  try {
    const adapter = createSesEmailAdapter({ region: 'us-east-1', from, configuration_set: 'synthetic' }, client);
    expect(await adapter.send(message)).toMatchObject({ outcome: 'sent', provider_message_id: 'synthetic-message' });
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: expectedFrom,
      Destination: { ToAddresses: [message.to] },
      Content: { Simple: {
        Subject: { Data: message.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: message.text, Charset: 'UTF-8' }, Html: { Data: message.html, Charset: 'UTF-8' } },
      } },
      EmailTags: [{ Name: 'git_tutor_attempt', Value: message.attempt_id }],
      ConfigurationSetName: 'synthetic',
    });
  } finally {
    client.destroy();
  }
});
