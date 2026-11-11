import { expect, test, type Page, type Locator, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AdminOffer, AdminPolicy, AdminPricing, PublicOffer } from '@/modules/catalog/queries';
import { adminDatabase, loadLocalSupabase } from '../helpers/supabase';

const baseURL = 'http://127.0.0.1:3000';
const forbidden = /fee_min_minor|fee_max_minor|private_fee_rule|compensation_policy_version|tutor_fee|internal_compensation|margin_minor|payout_destination|internal_notes|provider_token/;
async function signIn(page: Page, label: string | { id: string; email: string; password: string }) {
  const actor = typeof label === 'string' ? loadLocalSupabase().actors[label] : label;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => result.url().endsWith('/api/auth/login') && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByTestId('account-id')).toHaveText(actor.id, { timeout: 15_000 });
}
async function items<T>(request: APIRequestContext, path: string): Promise<T[]> {
  const all: T[] = []; let cursor: string | null = null;
  do {
    const query = path.startsWith('me/') ? '' : `${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response: APIResponse = await request.get(`/api/v1/${path}${query}`);
    expect(response.status()).toBe(200);
    const body = await response.json() as { data: { items: T[]; next_cursor: string | null } }; all.push(...body.data.items); cursor = body.data.next_cursor;
  } while (cursor);
  return all;
}
async function submit(page: Page, form: Locator, name: string, path: string, status = 200) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
  await form.getByRole('button', { name, exact: true }).click();
  const result = await response; expect(result.status()).toBe(status);
  return (await result.json()).data;
}
async function pickRecord(section: Locator, id: string) {
  await expect(section.getByRole('status').filter({ hasText: 'Loading current records…' })).toHaveCount(0);
  const button = section.getByRole('button').filter({ hasText: id.slice(0, 8) });
  for (let page = 0; await button.count() === 0 && page < 20; page++) {
    const more = section.getByRole('button', { name: 'Load more records', exact: true });
    if (!await more.count()) break;
    const previousCount = await section.locator('ul').getByRole('button').count();
    await more.click();
    await expect.poll(() => section.locator('ul').getByRole('button').count()).toBeGreaterThan(previousCount);
  }
  await expect(button).toHaveCount(1); await button.click();
}
async function approve(page: Page, section: Locator, kind: string, id: string) {
  const form = section.getByRole('form', { name: 'Approve this version', exact: true });
  await form.getByLabel('Effective from', { exact: true }).fill('2026-01-01T00:00');
  await form.getByLabel('Approval reason', { exact: true }).fill('Synthetic local browser approval');
  await submit(page, form, 'Approve this version', `${kind}/${id}/approve`);
  await expect(section.getByRole('status').filter({ hasText: 'Approval saved.' })).toBeVisible();
}

test('published catalog has working filters, readable terms and customer-safe responses', async ({ browser }, info) => {
  for (const actor of [null, 'learner_a']) {
    const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    try {
      const page = await context.newPage(); if (actor) await signIn(page, actor);
      const downloadedScripts: Promise<{ path: string; forbidden: boolean }>[] = [];
      page.on('response', response => {
        const url = new URL(response.url());
        if (response.status() === 200 && url.origin === baseURL && url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js')) downloadedScripts.push(response.text().then(body => ({ path: url.pathname, forbidden: forbidden.test(body) })));
      });
      const offers = await items<PublicOffer>(page.request, 'public/offers');
      expect(offers.length).toBeGreaterThan(0); expect(JSON.stringify(offers)).not.toMatch(forbidden);
      const offer = offers.find(item => item.format === 'group')!; expect(offer).toBeTruthy();
      await page.goto('/subjects'); await expect(page.getByRole('heading', { name: 'Start with your subject.' })).toBeVisible();
      await page.goto('/offers'); await page.getByLabel('Subject', { exact: true }).selectOption(offer.subject.subject_id); await page.getByLabel('Study format', { exact: true }).selectOption('group'); await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`subject_id=${offer.subject.subject_id}.*format=group`));
      await page.goto(`/offers/${offer.offer_id}`); await expect(page.getByRole('heading', { name: offer.title, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Before you reserve' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Reservations not open yet' })).toBeDisabled();
      expect(await page.content()).not.toMatch(forbidden); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const path of ['policies', 'pricing-versions', 'offers', 'tutors']) expect((await page.request.get(`/api/v1/${path}`)).status()).toBe(actor ? 403 : 401);
      expect((await Promise.all(downloadedScripts)).filter(script => script.forbidden)).toEqual([]);
    } finally { await context.close(); }
  }
});

test('administrator creates, approves and publishes through structured editors without leaking compensation', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const admin = await browser.newContext({ baseURL, viewport: info.project.use.viewport }); const publicContext = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const page = await admin.newPage(); await signIn(page, 'admin_a');
    const initialPricing = await items<AdminPricing>(page.request, 'pricing-versions'); const initialPolicies = await items<AdminPolicy>(page.request, 'policies');
    const sourcePolicy = initialPolicies.find(item => item.scope === 'group' && item.status === 'published' && item.content.group_target_size === 2 && item.content.package_enabled === false)!;
    expect(sourcePolicy).toBeTruthy(); const sourcePricing = initialPricing.find(item => item.pricing_version_id === sourcePolicy.content.customer_pricing_version)!;
    await page.goto('/admin/catalog');
    const pricing = page.locator('#pricing'); const policies = page.locator('#policies'); const offers = page.locator('#offers');
    await pickRecord(pricing, sourcePricing.pricing_version_id); await pricing.getByRole('button', { name: 'Create a new draft from this version' }).click();
    const pricingForm = pricing.getByRole('form', { name: 'Create pricing draft' }); await pricingForm.getByLabel('Duration in minutes', { exact: true }).fill('61');
    const priceResult = await submit(page, pricingForm, 'Create pricing draft', 'pricing-versions', 201);
    await approve(page, pricing, 'pricing-versions', priceResult.pricing_version_id);
    await pickRecord(policies, sourcePolicy.policy_version_id); await policies.getByRole('button', { name: 'Create a new draft from this version' }).click();
    const policyForm = policies.getByRole('form', { name: 'Create policy draft' });
    await policyForm.getByLabel('Approved pricing', { exact: true }).selectOption(priceResult.pricing_version_id);
    await policyForm.getByLabel('Deposit percentage', { exact: true }).fill('0'); await policyForm.getByLabel('Keep remaining learners’ prices after a dropout', { exact: true }).selectOption('false');
    const policyResult = await submit(page, policyForm, 'Create policy draft', 'policies', 201);
    // A draft offer can be created before final policy approval, allowing package eligibility to reference it.
    const createOffer = offers.getByRole('form', { name: 'Create offer draft' }); const subject = (await items<{ subject_id: string; title: string }>(page.request, 'me/application-subjects'))[0];
    await createOffer.getByLabel('Subject', { exact: true }).selectOption(subject.subject_id); await createOffer.getByLabel('Saved commercial terms', { exact: true }).selectOption(policyResult.policy_version_id);
    const offerResult = await submit(page, createOffer, 'Create offer draft', 'offers', 201);
    const anonymous = await publicContext.newPage(); await anonymous.goto(`/offers/${offerResult.offer_id}`); await expect(anonymous.getByRole('heading', { name: 'This page is not available.' })).toBeVisible(); expect(await items<PublicOffer>(anonymous.request, `public/offers?offer_id=${offerResult.offer_id}`)).toEqual([]);
    const packageForm = policies.getByRole('form', { name: 'Save draft changes', exact: true });
    await packageForm.getByLabel('Allow package funding', { exact: true }).check();
    await packageForm.getByRole('checkbox', { name: new RegExp(offerResult.offer_id.slice(0, 8)) }).check();
    await packageForm.getByLabel('Included sessions', { exact: true }).fill('3');
    await packageForm.getByLabel('Minutes per included session', { exact: true }).fill('61');
    await packageForm.getByLabel('Package purchase price (EGP)', { exact: true }).fill('1500');
    await packageForm.getByRole('checkbox', { name: 'Study group', exact: true }).check();
    await packageForm.getByLabel('How coverage works', { exact: true }).selectOption('named_entitlement_covers_eligible_occurrence');
    await packageForm.getByRole('checkbox', { name: 'Reserved included sessions', exact: true }).check();
    await submit(page, packageForm, 'Save draft changes', `policies/${policyResult.policy_version_id}/update`);
    await approve(page, policies, 'policies', policyResult.policy_version_id);
    const publish = offers.getByRole('form', { name: 'Publish offer' }); await publish.getByLabel('Effective from', { exact: true }).fill('2026-01-01T00:00'); await submit(page, publish, 'Publish offer', `offers/${offerResult.offer_id}/publish`);
    await expect(offers.getByRole('link', { name: 'Customer preview' })).toBeVisible();
    await anonymous.goto(`/offers/${offerResult.offer_id}`);
    await expect(anonymous.getByText('61 minutes', { exact: true })).toBeVisible(); await expect(anonymous.getByText('0% of the tuition is required for confirmation through an approved funding source.', { exact: true })).toBeVisible();
    await expect(anonymous.getByText('This package does not expire.', { exact: true })).toBeVisible();
    const publicRows = await items<PublicOffer>(anonymous.request, `public/offers?offer_id=${offerResult.offer_id}`); expect(publicRows).toHaveLength(1); await expect(anonymous.getByRole('heading', { name: publicRows[0].title, exact: true })).toBeVisible(); expect(publicRows[0].seat_price_minor).toBe(57500); expect(JSON.stringify(publicRows)).not.toMatch(forbidden); expect(await anonymous.content()).not.toMatch(forbidden);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('.local/ui-review', { recursive: true }); await admin.storageState({ path: `.local/ui-review/t03-${info.project.name}-admin.json` }); await writeFile(`.local/ui-review/t03-${info.project.name}-catalog.json`, JSON.stringify({ offer_id: offerResult.offer_id, policy_id: policyResult.policy_version_id, pricing_id: priceResult.pricing_version_id }));
  } finally { await admin.close(); await publicContext.close(); }
});

test('approved tutor biography survives a new unapproved edit and excludes private contacts', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const database = await adminDatabase(); await database.end();
  const config = loadLocalSupabase(); const auth = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = { email: `catalog.${randomUUID()}@example.test`, password: `Synthetic-${randomUUID()}!` }; const created = await auth.auth.admin.createUser({ ...actor, email_confirm: true }); if (created.error || !created.data.user) throw new Error('LOCAL_FIXTURE_CREATION_FAILED');
  const tutor = await browser.newContext({ baseURL, viewport: info.project.use.viewport }); const admin = await browser.newContext({ baseURL, viewport: info.project.use.viewport }); const anonymous = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const tutorPage = await tutor.newPage(); await signIn(tutorPage, { ...actor, id: created.data.user.id }); const adminPage = await admin.newPage(); await signIn(adminPage, 'admin_a');
    const contacts = await items<{ contact_id: string }>(tutorPage.request, 'me/contacts'); const subjects = await items<{ subject_id: string }>(tutorPage.request, 'me/application-subjects'); const displayName = `Synthetic catalog tutor ${randomUUID().slice(0, 6)}`;
    const application = await tutorPage.request.post('/api/v1/tutor-applications', { headers: { Origin: baseURL, 'Idempotency-Key': randomUUID() }, data: { display_name: displayName, bio: 'Approved synthetic biography for a local browser check.', subject_ids: [subjects[0].subject_id], contact_id: contacts[0].contact_id } }); expect(application.status()).toBe(201); const applicationId = (await application.json()).data.application_id;
    const approval = await adminPage.request.post(`/api/v1/tutor-applications/${applicationId}/review`, { headers: { Origin: baseURL, 'Idempotency-Key': randomUUID() }, data: { decision: 'approved', reason: 'Synthetic profile approval fixture', approved_subject_ids: [subjects[0].subject_id], expected_version: 1 } }); expect(approval.status()).toBe(200); const tutorId = (await approval.json()).data.tutor_id;
    await adminPage.goto('/admin/catalog'); const profiles = adminPage.locator('#profiles'); await pickRecord(profiles, tutorId);
    const review = profiles.getByRole('form', { name: 'Save biography decision', exact: true }); await review.getByLabel('Decision reason', { exact: true }).fill('Review of the exact submitted synthetic biography'); await submit(adminPage, review, 'Save biography decision', `tutor-profiles/${tutorId}/approve`);
    const publicPage = await anonymous.newPage(); await publicPage.goto(`/tutors/${tutorId}`); await expect(publicPage.getByText('Approved synthetic biography for a local browser check.', { exact: true })).toBeVisible();
    await tutorPage.goto('/tutor'); const profileForm = tutorPage.getByRole('form', { name: 'Save profile', exact: true }); await profileForm.getByLabel('Teaching experience and biography', { exact: true }).fill('UNAPPROVED_SYNTHETIC_BIOGRAPHY'); await submit(tutorPage, profileForm, 'Save profile', 'tutor/profile');
    await publicPage.reload(); await expect(publicPage.getByText('Approved synthetic biography for a local browser check.', { exact: true })).toBeVisible(); await expect(publicPage.getByText('UNAPPROVED_SYNTHETIC_BIOGRAPHY')).toHaveCount(0);
    const response = await publicPage.request.get(`/api/v1/public/tutors/${tutorId}`); expect(response.status()).toBe(200); const safe = JSON.stringify((await response.json()).data); expect(safe).not.toContain(actor.email); expect(safe).not.toContain(contacts[0].contact_id); expect(safe).not.toMatch(forbidden); expect(await publicPage.content()).not.toContain(actor.email);
    const liveOffers = await items<AdminOffer>(adminPage.request, 'offers'); expect(Array.isArray(liveOffers)).toBe(true);
  } finally { await tutor.close(); await admin.close(); await anonymous.close(); }
});
