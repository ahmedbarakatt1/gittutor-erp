import { afterEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createFakeCalendarAdapter, type CalendarDesired } from '../../src/server/providers/calendar';
import { createLocalEmailAdapter } from '../../src/server/providers/email';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    // Only remove the exact temporary directories this suite created.
    const target = resolve(directory), parent = resolve(tmpdir());
    if (!target.startsWith(`${parent}${sep}`) || !target.includes('git-tutor-fake-recipient-')) throw new Error('UNEXPECTED_TEST_DIRECTORY');
    await rm(target, { recursive: true, force: true });
  }
});
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'git-tutor-fake-recipient-'));
  directories.push(directory); return directory;
}
function desired(email: string): CalendarDesired {
  const id = randomUUID();
  return { occurrence_id: id, occurrence_version: 1, connection_id: randomUUID(), connection_version: 1, credential_version: null, calendar_id: email, provider_event_id: `gt${id.replaceAll('-', '')}`, meeting_generation: 1, conference_request_id: randomUUID(), action: 'upsert', start_at: '2030-01-01T10:00:00Z', end_at: '2030-01-01T11:00:00Z', tutor_email: email, title: 'Synthetic preview session' };
}
function message(to: string) { return { attempt_id: randomUUID(), to, subject: 'Synthetic preview', text: 'Preview only', html: '<p>Preview only</p>' }; }

test.each(['learner@example.test', 'learner@preview.gittutor.invalid', 'learner@PREVIEW.GITTUTOR.INVALID'])('fake adapters persist and reconcile reserved recipient %s without network calls', async (recipient) => {
  vi.stubEnv('APP_ENV', 'development');
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NETWORK_MUST_NOT_BE_USED'));
  const directory = await temporaryDirectory(), calendarPath = join(directory, 'calendar'), emailPath = join(directory, 'email');
  const d = desired(recipient), email = message(recipient);
  expect((await createFakeCalendarAdapter(calendarPath, 'timeout_after_success').apply(d)).outcome).toBe('unknown');
  expect((await createFakeCalendarAdapter(calendarPath).reconcile(d)).outcome).toBe('ready');
  expect(JSON.parse(await readFile(join(calendarPath, `${d.provider_event_id}.json`), 'utf8')).outcome).toBe('ready');
  expect((await createLocalEmailAdapter(emailPath, true, 'timeout_after_success').send(email)).outcome).toBe('unknown');
  expect((await createLocalEmailAdapter(emailPath, true).reconcile(email.attempt_id)).outcome).toBe('sent');
  expect(JSON.parse(await readFile(join(emailPath, `${email.attempt_id}.json`), 'utf8')).message.to).toBe(recipient);
  expect(network).not.toHaveBeenCalled();
});
test.each(['person@gmail.com', 'person@gittutor.invalid', 'person@sub.preview.gittutor.invalid', 'person@preview.gittutor.invalid.example.com', 'person@evilpreview.gittutor.invalid', 'person@sub.example.test', 'person@notexample.test', 'person@example.test.evil', '@preview.gittutor.invalid', 'bad@@example.test', 'bad space@example.test', 'person@example.test\n'])('fake adapters reject real, malformed or lookalike recipient %s', async (recipient) => {
  const directory = await temporaryDirectory();
  await expect(createFakeCalendarAdapter(directory).apply(desired(recipient))).rejects.toThrow('SYNTHETIC_CALENDAR_REQUIRED');
  await expect(createLocalEmailAdapter(directory, true).send(message(recipient))).rejects.toThrow('SYNTHETIC_EMAIL_REQUIRED');
  expect(await readdir(directory)).toEqual([]);
});
test.each(['production', 'staging', 'invalid'])('fake adapters remain unavailable in APP_ENV=%s', (environment) => {
  vi.stubEnv('APP_ENV', environment);
  expect(() => createFakeCalendarAdapter('unused')).toThrow('FAKE_CALENDAR_REQUIRES_ISOLATION');
  expect(() => createLocalEmailAdapter('unused', true)).toThrow('FAKE_EMAIL_REQUIRES_ISOLATION');
});
test('email still requires the explicit isolated configuration flag', () => {
  vi.stubEnv('APP_ENV', 'development');
  expect(() => createLocalEmailAdapter('unused', false)).toThrow('FAKE_EMAIL_REQUIRES_ISOLATION');
});
