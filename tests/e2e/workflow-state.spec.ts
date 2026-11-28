import { expect, test } from '@playwright/test';
import { expectSignedInAccount } from '../helpers/browser-auth';
import { loadLocalSupabase } from '../helpers/supabase';
import { workflowOperationsSchema } from '../../src/modules/workflow-import/operational-model';

test('loading and refreshing workbook history preserves current workflow input', async ({ page }) => {
  test.info().annotations.push({ type: 'presentation-fixture', description: 'Real local authentication and session directory; only the history response is synthetic and delayed. No business command is submitted.' });
  const actor = loadLocalSupabase().actors.admin_a;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expectSignedInAccount(page, actor.id);

  const data = workflowOperationsSchema.parse({ enabled: true, role: 'owner', mapping_options: { learners: [], tutors: [] }, sections: [{ key: 'sessions', title: 'Synthetic session history', description: 'Presentation regression only', metrics: [], records: [] }] });
  let release: () => void = () => {};
  let gate = new Promise<void>(resolve => { release = resolve; });
  let unavailable = false;
  await page.route('**/api/v1/workflow-operations?workspace=admin', async route => {
    await gate;
    await route.fulfill(unavailable ? { status: 503, json: { code: 'UNAVAILABLE' } } : { json: { data } });
  });
  try {
    await page.goto('/admin/sessions');
    const field = page.getByLabel('Session status', { exact: true });
    await field.selectOption('completed');
    release();
    const history = page.locator('[data-workflow-operations]');
    await expect(history).toBeVisible();
    await expect(field).toHaveValue('completed');

    gate = new Promise<void>(resolve => { release = resolve; });
    await history.getByRole('button', { name: 'Refresh records', exact: true }).click();
    await expect(page.getByText('Loading your records…', { exact: true })).toBeVisible();
    await expect(field).toHaveValue('completed');
    release();
    await expect(history).toBeVisible();
    await expect(field).toHaveValue('completed');

    unavailable = true;
    await history.getByRole('button', { name: 'Refresh records', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Workbook records could not be loaded.' })).toBeVisible();
    await expect(field).toHaveValue('completed');
  } finally {
    release();
    await page.unroute('**/api/v1/workflow-operations?workspace=admin');
  }
});

test('reported chart drilldowns open their matching source rows and preserve current workflow controls', async ({ page }) => {
  const actor = loadLocalSupabase().actors.admin_a;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expectSignedInAccount(page, actor.id);

  const records = ['Completed', 'Scheduled', null].map((status, index) => ({
    id: 'd3c78931-96e2-4d52-9860-' + String(index + 1).padStart(12, '0'),
    title: ['Synthetic completed lesson', 'Synthetic planned lesson', 'Synthetic undated lesson'][index], subtitle: 'Practice course',
    source_table: 'sessions', source_row: index + 2, reported_status: status, date: index === 2 ? null : '2026-10-06',
    fields: [{ key: 'course', label: 'Course', value: 'Synthetic subject', type: 'text' }], issues: [], actions: [],
    review: { version: 1, state: 'linked', can_review: false },
    links: { learner_id: null, tutor_id: null, occurrence_id: null, package_id: null },
  }));
  const data = workflowOperationsSchema.parse({ enabled: true, role: 'owner', mapping_options: { learners: [], tutors: [] },
    sections: [{ key: 'sessions', title: 'Synthetic session history', description: 'Presentation fixture', metrics: [], records }] });
  await page.route('**/api/v1/workflow-operations?workspace=admin', route => route.fulfill({ json: { data } }));
  await page.goto('/admin/sessions');
  const history = page.locator('[data-workflow-operations]');
  const current = page.getByLabel('Session status', { exact: true });
  await current.selectOption('completed');

  const complete = history.getByRole('button', { name: 'Completed 1', exact: true });
  await expect(complete).toHaveAccessibleDescription('Show 1 record for Completed');
  await complete.focus();
  await complete.press('Enter');
  const row = history.locator('summary').filter({ hasText: 'Synthetic completed lesson' });
  await expect(row).toBeVisible();
  await expect(history.getByText('Synthetic planned lesson')).toHaveCount(0);
  await row.click();
  await expect(history.getByText('Synthetic subject', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'No valid date 1', exact: true }).click();
  await expect(history.getByText('Synthetic undated lesson')).toBeVisible();
  await history.getByRole('button', { name: 'Clear filters' }).click();
  await expect(history.getByText('Synthetic planned lesson')).toBeVisible();
  await expect(current).toHaveValue('completed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
