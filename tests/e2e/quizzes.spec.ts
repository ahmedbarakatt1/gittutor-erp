import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectSignedInAccount } from '../helpers/browser-auth';
import { runFileScan, syntheticPdf } from '../helpers/files';
import { groupRemovalFixture } from '../helpers/group-removal';
import { loadLocalSupabase } from '../helpers/supabase';

test.use({ trace: 'off', screenshot: 'off' });

async function signIn(page: Page, actor: { id: string; email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expectSignedInAccount(page, actor.id);
}

test('a tutor publishes a PDF, records and corrects a private grade, and a student reads it', async ({ browser }, info) => {
  test.setTimeout(120000);
  const fixture = await groupRemovalFixture(3);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({
    baseURL: 'http://127.0.0.1:3000', viewport: info.project.use.viewport,
  })));
  try {
    const [tutor, student] = await Promise.all(contexts.map(context => context.newPage()));
    const title = 'Linear equations ' + randomUUID().slice(0, 8);
    const filename = 'linear-equations.pdf';
    await signIn(tutor, fixture.actor);
    await signIn(student, loadLocalSupabase().actors.learner_a);
    await tutor.goto('/tutor/quizzes?occurrence=' + fixture.occurrenceId);
    await tutor.getByText('Add a PDF quiz', { exact: true }).click();
    const file = tutor.getByLabel('Choose a file', { exact: true });
    await expect(file).toHaveAttribute('accept', 'application/pdf');
    await file.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: syntheticPdf });
    const completion = tutor.waitForResponse(r => /\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(r.url()).pathname));
    await tutor.getByRole('button', { name: 'Upload and check file', exact: true }).click();
    const queued = await completion;
    expect(queued.status()).toBe(202);
    await runFileScan((await queued.json()).data.scan_job_id);
    await expect(tutor.getByLabel('Quiz PDF', { exact: true })).toHaveValue(/[0-9a-f-]{36}/, { timeout: 15000 });
    await tutor.getByLabel('Quiz title').fill(title);
    await tutor.getByLabel('Maximum points').fill('20');
    await tutor.getByRole('button', { name: 'Publish quiz', exact: true }).click();
    const gradebook = tutor.locator('details').filter({ has: tutor.locator('summary').filter({ hasText: title }) });
    await gradebook.locator('summary').click();
    await gradebook.getByLabel('Learner', { exact: true }).selectOption(fixture.learners[0]);

    await student.goto('/learn/grades');
    const row = student.getByRole('listitem').filter({ has: student.getByRole('heading', { name: title, exact: true }) });
    await expect(row.getByText('Awaiting grade')).toBeVisible();
    const url = await row.getByRole('link', { name: 'Download PDF · ' + title }).getAttribute('href');
    const download = await student.request.get(url!);
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(syntheticPdf);

    for (const [score, action] of [['0', 'Publish grade'], ['16.5', 'Update grade']]) {
      await gradebook.getByLabel('Points earned').fill(score);
      const posted = tutor.waitForResponse(r => new URL(r.url()).pathname.endsWith('/grades') && r.request().method() === 'POST');
      await gradebook.getByRole('button', { name: action }).click();
      expect((await posted).ok()).toBe(true);
      await student.reload();
      await expect(row.getByText(score + ' / 20', { exact: true })).toBeVisible();
    }
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await tutor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await fixture.close();
  }
});
