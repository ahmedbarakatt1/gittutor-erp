import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { fixtureId } from '../../tools/db-seed';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { adminDatabase, anonymousClient, authClient, loadLocalSupabase } from '../helpers/supabase';

async function login(page: Page, actor: { email: string; password: string }, path: string) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(path + '$'), { timeout: 45000 });
}

test('GT-ADM-120 rechecks an isolated organizer and dates only the simulated proof', async ({ page }) => {
  test.setTimeout(120000);
  const guard = await adminDatabase();
  await guard.end();
  const admin = await authClient('admin_a');
  try {
    const added = await admin.rpc('add_fake_calendar_organizer', { p_idempotency_key: randomUUID() });
    expect(added.error).toBeNull();
    const id = added.data.connection_id as string;
    await login(page, loadLocalSupabase().actors.admin_a, '/admin');
    await page.goto('/admin/integrations');
    const organizer = page.locator('#organizer-' + id);
    await expect(organizer).toContainText('No check recorded', { timeout: 30000 });
    await organizer.locator('summary').click();
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/calendar/connect');
    await organizer.getByRole('button', { name: 'Recheck room provisioning' }).click();
    expect((await response).status()).toBe(200);
    await expect(organizer.locator('time')).toBeVisible({ timeout: 30000 });
    const timestamp = await organizer.locator('time').getAttribute('datetime');
    expect(Date.now() - Date.parse(timestamp!)).toBeLessThan(120000);
    await page.reload();
    await expect(organizer.locator('time')).toHaveAttribute('datetime', timestamp!, { timeout: 30000 });
    await expect(organizer).toContainText('Simulated rooms');
  } finally { await admin.auth.signOut({scope:'local'}); }
});

test('J6 one applicant becomes a published tutor and sees the scheduled lesson', async ({ page }) => {
  test.setTimeout(120000);
  const db = await adminDatabase(), config = loadLocalSupabase();
  const service = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = await authClient('admin_a'), applicant = anonymousClient();
  const email = 'new-tutor.' + randomUUID() + '@example.test', password = 'Synthetic-' + randomUUID() + '!';
  const subject = fixtureId('subject_calculus'), displayName = 'Synthetic journey tutor ' + randomUUID().slice(0, 8);
  try {
    const created = await service.auth.admin.createUser({email,password,email_confirm:true});
    expect(created.error).toBeNull();
    expect((await applicant.auth.signInWithPassword({email,password})).error).toBeNull();
    expect((await applicant.rpc('get_my_account')).data.roles).toEqual(['student']);
    const contact = (await db.query('select id from app_private.verified_contacts where account_id=$1 and revoked_at is null', [created.data.user!.id])).rows[0];
    const application = await applicant.rpc('submit_tutor_application', {p_display_name:displayName,
      p_contact_id:contact.id,p_subject_ids:[subject],p_bio:'Synthetic calculus teaching biography.',p_idempotency_key:randomUUID()});
    expect(application.error).toBeNull();
    expect((await db.query('select state from app_private.tutor_applications where id=$1',[application.data.application_id])).rows[0].state).toBe('pending');
    const decision = await admin.rpc('review_tutor_application', {p_application_id:application.data.application_id,
      p_approved_subject_ids:[subject],p_decision:'approved',p_reason:'Reviewed journey applicant',p_expected_version:1,p_idempotency_key:randomUUID()});
    expect(decision.error).toBeNull();
    const tutorId = decision.data.tutor_id;
    const profile = (await db.query('select version,draft_profile_version_id from app_private.tutors where id=$1',[tutorId])).rows[0];
    const published = await admin.rpc('approve_tutor_profile', {p_tutor_id:tutorId,p_profile_version_id:profile.draft_profile_version_id,
      p_decision:'approved',p_reason:'Reviewed synthetic public profile',p_expected_version:profile.version,p_idempotency_key:randomUUID()});
    expect(published.error).toBeNull();
    const customer = await authClient('learner_d');
    const visible = await customer.rpc('get_public_tutor', {p_tutor_id:tutorId});
    await customer.auth.signOut({scope:'local'});
    expect(visible.error).toBeNull();
    expect(visible.data).toMatchObject({tutor_id:tutorId,display_name:displayName});
    await login(page,{email,password},'/tutor');
    const weekly = Array.from({length:7},(_,i)=>({weekday:i+1,start_local:'06:00',end_local:'23:00'}));
    const saved = await applicant.rpc('set_availability', {p_tutor_id:tutorId,p_weekly_intervals:weekly,p_dated_exceptions:[],
      p_reason:'New tutor teaching hours',p_expected_version:0,p_idempotency_key:randomUUID()});
    expect(saved.error).toBeNull();
    expect((await applicant.rpc('get_tutor_availability')).data.weekly_intervals).toEqual(weekly);
    const start = new Date(Date.now()+5*86400000);start.setUTCHours(10,0,0,0);
    const scheduled = await admin.rpc('create_occurrence',{p_offer_id:catalogFixtureIds.private_offer,p_tutor_id:tutorId,
      p_start_at:start.toISOString(),p_end_at:new Date(start.getTime()+3600000).toISOString(),p_time_zone:'Africa/Cairo',p_target_tier:null,p_idempotency_key:randomUUID()});
    expect(scheduled.error).toBeNull();
    await page.goto('/tutor/schedule?occurrence='+scheduled.data.occurrence_id);
    const assigned = await page.request.get('/api/v1/tutor/occurrences?occurrence_id='+scheduled.data.occurrence_id);
    expect(assigned.status()).toBe(200);
    expect((await assigned.json()).data.items[0].occurrence).toMatchObject({occurrence_id:scheduled.data.occurrence_id,tutor:{tutor_id:tutorId}});
    await expect(page.getByRole('region',{name:'Session room',exact:true})).toBeVisible({timeout:30000});
  } finally {
    await Promise.all([admin.auth.signOut({scope:'local'}),applicant.auth.signOut({scope:'local'}),db.end()]);
  }
});
