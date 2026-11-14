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
  await page.route('**/api/v1/workflow-operations', async route => {
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
    await page.unroute('**/api/v1/workflow-operations');
  }
});
