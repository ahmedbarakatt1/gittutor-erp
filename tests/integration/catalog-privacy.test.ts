import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { adminDatabase, anonymousClient, authClient, loadLocalSupabase } from '../helpers/supabase';
import { fixtureId } from '../../tools/db-seed';
import { policyFixture, policyId, policyVectors, pricingFixture, pricingVectors } from '../unit/policy-vectors';
import { seedCatalog, catalogFixtureIds } from '../../tools/catalog-seed';

type Json = Record<string, unknown>;
const settings = JSON.parse(readFileSync('contracts/policy-settings.json', 'utf8')) as { development_examples: { fixture_id: string; policy?: Json }[] };
const privateCustomer = { currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: 60, group_tiers: null, private_seat_price_minor: 50000 };
const privateCompensation = { currency: 'EGP', group_fee_bands: null, private_fee_rule: { currency: 'EGP', fee_min_minor: 25000, fee_max_minor: 25000, exact_occurrence_approval_required: true } };
function policy(pricingId: string): Json {
  const source = structuredClone(settings.development_examples.find(item => item.fixture_id === 'synthetic_private_booking_policy_v1')!.policy!);
  for (const key of ['policy_version_id', 'status', 'environment_scope', 'is_synthetic', 'approved_by', 'approved_at', 'effective_at']) delete source[key];
  return { ...source, customer_pricing_version: pricingId, compensation_policy_version: pricingId };
}

describe('T03 catalog approval and customer confidentiality on real Supabase', () => {
  let database: Client;
  const clients: Record<string, ReturnType<typeof anonymousClient>> = {};
  let adminId: string;
  let adminGrant: string;
  const effectiveAt = new Date(Date.now() - 60000).toISOString();
  beforeAll(async () => {
    database = await adminDatabase();
    const config = loadLocalSupabase();
    const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `catalog.${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}!`;
    const created = await provider.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`CATALOG_AUTH_FIXTURE_FAILED:${created.error?.code}`);
    adminId = created.data.user.id;
    adminGrant = (await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','isolated catalog test bootstrap') returning id", [adminId])).rows[0].id;
    clients.admin = anonymousClient();
    if ((await clients.admin.auth.signInWithPassword({ email, password })).error) throw new Error('CATALOG_AUTH_FIXTURE_FAILED');
    clients.anon = anonymousClient();
    for (const [name, label] of Object.entries({ student: 'learner_a', guardian: 'guardian_a', tutor: 'tutor_a', cs: 'cs_a' })) clients[name] = await authClient(label);
  });
  afterAll(async () => { await Promise.all(Object.values(clients).map(client => client.auth.signOut({ scope: 'local' }))); await database?.end(); });
  async function rpc(name: string, args: Json = {}, who = 'admin'): Promise<Json> {
    const result = await clients[who].rpc(name, args);
    expect(result.error?.message, name).toBeUndefined();
    return result.data as Json;
  }
  async function pricing(scope = 'private', priceOverride?: Json) {
    const fixture = scope === 'private' ? { customer_pricing: privateCustomer, compensation: privateCompensation } : pricingFixture('group');
    const created = await rpc('create_pricing_draft', { p_scope: scope, p_customer_pricing: priceOverride || fixture.customer_pricing, p_compensation: fixture.compensation, p_idempotency_key: randomUUID() });
    await rpc('approve_pricing_version', { p_pricing_version_id: created.pricing_version_id, p_effective_at: effectiveAt, p_approval_note: 'Synthetic isolated pricing approval', p_expected_version: 1, p_idempotency_key: randomUUID() });
    return created.pricing_version_id as string;
  }
  async function draftOffer(contentChange: Json = {}) {
    const pricingId = await pricing();
    const content = { ...policy(pricingId), ...contentChange };
    const created = await rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'private', p_content: content, p_idempotency_key: randomUUID() });
    const offer = await rpc('create_offer', { p_subject_id: fixtureId('subject_calculus'), p_format: 'private', p_duration_minutes: 60, p_capacity: 1, p_target_tier: null, p_pricing_version_id: pricingId, p_policy_version_id: created.policy_version_id, p_idempotency_key: randomUUID() });
    return { pricingId, policyId: created.policy_version_id as string, offerId: offer.offer_id as string, content };
  }
  async function publish(fixture: Awaited<ReturnType<typeof draftOffer>>) {
    await rpc('approve_policy_version', { p_policy_version_id: fixture.policyId, p_effective_at: effectiveAt, p_approval_note: 'Synthetic isolated commercial approval', p_expected_version: 1, p_idempotency_key: randomUUID() });
    return rpc('publish_offer', { p_offer_id: fixture.offerId, p_effective_at: effectiveAt, p_expected_version: 1, p_idempotency_key: randomUUID() });
  }

  test('signed-out visitors and support guests cannot read persisted offers or tutor profiles', async () => {
    const guest = anonymousClient();
    expect((await guest.auth.signInAnonymously()).error).toBeNull();
    try {
      for (const visitor of [clients.anon, guest]) {
        const offers = await visitor.rpc('list_public_offers', {});
        const tutor = await visitor.rpc('get_public_tutor', { p_tutor_id: randomUUID() });
        for (const result of [offers, tutor]) {
          expect(result.error).toBeTruthy();
          expect(result.error?.message).not.toBe('NOT_FOUND');
          expect(result.data).toBeNull();
        }
      }
    } finally {
      await guest.auth.signOut({ scope: 'local' });
    }
  });

  test('GT-1604 catalog seed preserves canonical records and publishes the four required subject areas idempotently', async () => {
    await seedCatalog();
    const subjects = ['computer_science', 'engineering', 'business', 'business_intelligence'];
    const offerIds = [catalogFixtureIds.group2_offer, catalogFixtureIds.group3_offer, catalogFixtureIds.group4_offer, catalogFixtureIds.private_offer,
      ...subjects.map(label => fixtureId(`fixture_${label}_private_60_minute_offer`))];
    const snapshot = async () => (await database.query('select id,status,version,pricing_version_id,policy_version_id,published_at from app_private.offers where id=any($1::uuid[]) order by id', [offerIds])).rows;
    const before = await snapshot();
    expect(before).toHaveLength(8);
    expect(before.every(row => row.status === 'published')).toBe(true);
    const areas = (await database.query('select title from app_private.subjects where id=any($1::uuid[]) order by title', [subjects.map(label => fixtureId(`subject_${label}`))])).rows.map(row => row.title);
    expect(areas).toEqual(['Business', 'Business Intelligence', 'Computer Science', 'Engineering']);
    const audit = (await database.query("select count(*)::int as count from app_private.audit_events where action='synthetic_catalog_draft_seeded'")).rows[0].count;
    await seedCatalog();
    expect(await snapshot()).toEqual(before);
    expect((await database.query("select count(*)::int as count from app_private.audit_events where action='synthetic_catalog_draft_seeded'")).rows[0].count).toBe(audit);
  });

  test('GT-1211 GT-1212 synthetic publication exposes customer terms and keeps finance outside every customer role', async () => {
    const fixture = await draftOffer();
    expect((await rpc('list_public_offers', { p_offer_id: fixture.offerId }, 'student')).items).toEqual([]);
    await publish(fixture);
    for (const who of ['student', 'guardian', 'tutor', 'cs']) {
      const result = await rpc('list_public_offers', { p_offer_id: fixture.offerId }, who);
      const rows = result.items as Json[];
      expect(rows).toHaveLength(1);
      expect(rows[0].seat_price_minor).toBe(50000);
      expect(rows[0].duration_minutes).toBe(60);
      expect(JSON.stringify(result)).not.toMatch(/fee_min|fee_max|tutor_fee|compensation|private_fee_rule|margin|payout|internal_notes/);
      expect(Object.keys(rows[0]).sort()).toEqual(['offer_id','title','subject','format','duration_minutes','capacity','target_tier','seat_price_minor','currency','pricing_version_id','policy_version_id','customer_terms_hash','policy_summary','availability'].sort());
      const denied = await clients[who].rpc('list_pricing_versions', {});
      expect(denied.error).toBeTruthy();
    }
    const privileged = await rpc('list_pricing_versions', {});
    expect(JSON.stringify(privileged)).toContain('fee_min_minor');
    const grants = await database.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and has_function_privilege('anon',p.oid,'EXECUTE') order by p.proname");
    expect(grants.rows.map(row => row.proname)).toEqual([]);
  });

  test('GT-1602 approval accepts explicit zero and false but refuses incomplete or incompatible policy', async () => {
    const fixture = await draftOffer({ deposit_basis_points: 0, package_enabled: false });
    await publish(fixture);
    const incomplete = await draftOffer({ hold_minutes: null });
    const denied = await clients.admin.rpc('approve_policy_version', { p_policy_version_id: incomplete.policyId, p_effective_at: effectiveAt, p_approval_note: 'Missing required setting', p_expected_version: 1, p_idempotency_key: randomUUID() });
    expect(denied.error?.message).toBe('POLICY_INCOMPLETE');
    const unsafe = await clients.admin.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'private', p_content: { ...fixture.content, deposit_basis_points: 0.5 }, p_idempotency_key: randomUUID() });
    expect(unsafe.error?.message).toBe('VALIDATION_ERROR');
    const incompatible = await draftOffer({ duration_minutes: 90 });
    const rejected = await clients.admin.rpc('approve_policy_version', { p_policy_version_id: incompatible.policyId, p_effective_at: effectiveAt, p_approval_note: 'Mismatched duration', p_expected_version: 1, p_idempotency_key: randomUUID() });
    expect(rejected.error?.message).toBe('POLICY_INCOMPLETE');
  });

  test('GT-1608 metadata spoofing fails and synthetic policy never passes a live publication gate', async () => {
    for (const field of ['environment_scope', 'is_synthetic', 'approved_by', 'approved_at', 'status', 'policy_version_id']) {
      const result = await clients.admin.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'private', p_content: { [field]: field === 'is_synthetic' ? false : 'forged' }, p_idempotency_key: randomUUID() });
      expect(result.error?.message).toBe('VALIDATION_ERROR');
    }
    await expect(database.query("select app_private.assert_catalog_publication('production','development_test',true)")).rejects.toThrow('POLICY_INCOMPLETE');
    await expect(database.query("select app_private.assert_catalog_publication('test','development_test',true)")).resolves.toBeTruthy();
  });

  test('approved pricing, policy and published offer bindings are immutable even through direct SQL', async () => {
    const fixture = await draftOffer();
    await publish(fixture);
    await expect(database.query("update app_private.policy_versions set content=content||'{\"deposit_basis_points\":9000}'::jsonb where id=$1", [fixture.policyId])).rejects.toThrow('IMMUTABLE_VERSION');
    await expect(database.query("update finance_private.pricing_compensation set content=content||'{\"private_fee_rule\":null}'::jsonb where pricing_version_id=$1", [fixture.pricingId])).rejects.toThrow('IMMUTABLE_VERSION');
    await expect(database.query('update app_private.offers set duration_minutes=90 where id=$1', [fixture.offerId])).rejects.toThrow('IMMUTABLE_VERSION');
  });

  test('approval/publication replay is singular and revoked admin membership denies a saved result', async () => {
    const args = { p_kind: 'booking', p_scope: 'private', p_content: {}, p_idempotency_key: randomUUID() };
    const one = await rpc('create_policy_draft', args);
    expect(await rpc('create_policy_draft', args)).toEqual(one);
    expect((await clients.admin.rpc('create_policy_draft', { ...args, p_content: { duration_minutes: 60 } })).error?.message).toBe('IDEMPOTENCY_CONFLICT');
    for (const who of ['student', 'guardian', 'tutor', 'cs']) expect((await clients[who].rpc('create_policy_draft', args)).error?.message).toBe('FORBIDDEN');
    await database.query('update app_private.account_roles set revoked_at=now() where id=$1', [adminGrant]);
    try { expect((await clients.admin.rpc('create_policy_draft', args)).error?.message).toBe('FORBIDDEN'); }
    finally { await database.query('update app_private.account_roles set revoked_at=null where id=$1', [adminGrant]); }
    expect((await database.query("select count(*)::int as count from app_private.audit_events where aggregate_id=$1 and action='policy_draft_created'", [one.policy_version_id])).rows[0].count).toBe(1);
  });

  test('shared policy and pricing malformed vectors agree in PostgreSQL and TypeScript', async () => {
    for (const vector of policyVectors()) {
      const result = await database.query('select app_private.catalog_policy_errors($1,$2,true,$3) as errors', [vector.content, vector.scope, policyId]);
      expect(result.rows[0].errors.length === 0, vector.name).toBe(vector.valid);
    }
    for (const vector of pricingVectors()) {
      const result = await database.query('select app_private.catalog_pricing_errors($1,$2,$3,true) as errors', [vector.customer_pricing, vector.compensation, vector.scope]);
      expect(result.rows[0].errors.length === 0, vector.name).toBe(vector.valid);
    }
  });

  test('GT-1203 GT-1204 exact occurrence-fee validator accepts inclusive approved bounds only', async () => {
    const id = await pricing('group');
    for (const [size, lower, upper] of [[2,45000,45000],[3,60000,65000],[4,70000,75000]]) {
      for (const fee of new Set([lower,upper])) await expect(database.query("select app_private.assert_exact_tutor_fee($1,$2,$3,'EGP',60)", [id,size,fee])).resolves.toBeTruthy();
      for (const fee of [lower-1,upper+1]) await expect(database.query("select app_private.assert_exact_tutor_fee($1,$2,$3,'EGP',60)", [id,size,fee])).rejects.toThrow('AMOUNT_OUT_OF_RANGE');
    }
    await expect(database.query("select app_private.assert_exact_tutor_fee($1,5,75000,'EGP',60)", [id])).rejects.toThrow('AMOUNT_OUT_OF_RANGE');
    await expect(database.query("select app_private.assert_exact_tutor_fee($1,3,62500,'USD',60)", [id])).rejects.toThrow('POLICY_INCOMPLETE');
  });

  test('GT-1211 a newly approved tariff does not reprice an existing published offer', async () => {
    const old = await draftOffer(); await publish(old);
    const id = await pricing('private', { ...privateCustomer, private_seat_price_minor: 60000 });
    const newContent = { ...policy(id), private_seat_price_minor: 60000 };
    const p = await rpc('create_policy_draft', { p_kind:'booking',p_scope:'private',p_content:newContent,p_idempotency_key:randomUUID() });
    const o = await rpc('create_offer', { p_subject_id:fixtureId('subject_calculus'),p_format:'private',p_duration_minutes:60,p_capacity:1,p_target_tier:null,p_pricing_version_id:id,p_policy_version_id:p.policy_version_id,p_idempotency_key:randomUUID() });
    await publish({ pricingId:id,policyId:p.policy_version_id as string,offerId:o.offer_id as string,content:newContent });
    const first = (await rpc('list_public_offers',{p_offer_id:old.offerId},'student')).items as Json[];
    const second = (await rpc('list_public_offers',{p_offer_id:o.offer_id},'student')).items as Json[];
    expect(first[0].seat_price_minor).toBe(50000); expect(second[0].seat_price_minor).toBe(60000);
    expect(first[0].pricing_version_id).toBe(old.pricingId); expect(second[0].pricing_version_id).toBe(id);
  });

  test('package identity is server-derived and draft eligibility resolves before immutable publication', async () => {
    const pricingId = await pricing('group');
    const content = policyFixture('group');
    content.customer_pricing_version=pricingId; content.compensation_policy_version=pricingId;
    const pack=content.package_contract as Json; pack.package_policy_version_id=null; pack.eligible_offer_ids=null;
    const created=await rpc('create_policy_draft',{p_kind:'booking',p_scope:'group',p_content:content,p_idempotency_key:randomUUID()});
    const id=created.policy_version_id as string;
    const stored=(await database.query('select app_private.policy_content($1) as content',[id])).rows[0].content as Json;
    expect((stored.package_contract as Json).package_policy_version_id).toBe(id);
    const wrong=await clients.admin.rpc('update_policy_draft',{p_policy_version_id:id,p_content:{...stored,package_contract:{...pack,package_policy_version_id:randomUUID()}},p_expected_version:1,p_idempotency_key:randomUUID()});
    expect(wrong.error?.message).toBe('VALIDATION_ERROR');
    const offer=await rpc('create_offer',{p_subject_id:fixtureId('subject_calculus'),p_format:'group',p_duration_minutes:60,p_capacity:4,p_target_tier:4,p_pricing_version_id:pricingId,p_policy_version_id:id,p_idempotency_key:randomUUID()});
    (stored.package_contract as Json).eligible_offer_ids=[offer.offer_id];
    const updated=await rpc('update_policy_draft',{p_policy_version_id:id,p_content:stored,p_expected_version:1,p_idempotency_key:randomUUID()});
    expect(updated.version).toBe(2);
    await rpc('approve_policy_version',{p_policy_version_id:id,p_effective_at:effectiveAt,p_approval_note:'Synthetic package approval',p_expected_version:2,p_idempotency_key:randomUUID()});
    await rpc('publish_offer',{p_offer_id:offer.offer_id,p_effective_at:effectiveAt,p_expected_version:1,p_idempotency_key:randomUUID()});
    const rows=(await rpc('list_public_offers',{p_offer_id:offer.offer_id},'student')).items as Json[];
    expect(rows[0].seat_price_minor).toBe(50000);
    expect(JSON.stringify(rows)).not.toMatch(/private_fee_rule|compensation|tutor_fee/);
  });

  test('public tutor biography changes require current admin approval and retain the prior approved version', async () => {
    const config=loadLocalSupabase();
    const provider=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});
    const email=`catalog.tutor.${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}!`;
    const created=await provider.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error||!created.data.user) throw new Error('CATALOG_TUTOR_FIXTURE_FAILED');
    const client=anonymousClient();
    clients.profile=client;
    if((await client.auth.signInWithPassword({email,password})).error) throw new Error('CATALOG_TUTOR_SIGNIN_FAILED');
    await rpc('grant_staff_role',{p_account_id:created.data.user.id,p_role:'tutor',p_reason:'Synthetic catalog tutor',p_idempotency_key:randomUUID()});
    const target=(await database.query('select t.id,t.contact_id,t.version from app_private.tutors t where t.account_id=$1',[created.data.user.id])).rows[0];
    const args={p_display_name:'Synthetic approved tutor',p_bio:'Approved synthetic public biography.',p_subject_ids:[fixtureId('subject_calculus')],p_contact_id:target.contact_id,p_locale:'en',p_expected_version:target.version,p_idempotency_key:randomUUID()};
    await rpc('update_tutor_profile',args,'profile');
    let record=(await database.query('select draft_profile_version_id,version from app_private.tutors where id=$1',[target.id])).rows[0];
    expect((await clients.student.rpc('get_public_tutor',{p_tutor_id:target.id})).error?.message).toBe('NOT_FOUND');
    await rpc('approve_tutor_profile',{p_tutor_id:target.id,p_profile_version_id:record.draft_profile_version_id,p_decision:'approved',p_reason:'Reviewed public teaching profile',p_expected_version:record.version,p_idempotency_key:randomUUID()});
    const first=await rpc('get_public_tutor',{p_tutor_id:target.id},'student');
    expect(first.bio).toBe(args.p_bio);
    expect(Object.keys(first).sort()).toEqual(['tutor_id','display_name','bio','subjects','photo_reference'].sort());
    record=(await database.query('select version from app_private.tutors where id=$1',[target.id])).rows[0];
    await rpc('update_tutor_profile',{...args,p_bio:'Unapproved replacement biography.',p_expected_version:record.version,p_idempotency_key:randomUUID()},'profile');
    expect(await rpc('get_public_tutor',{p_tutor_id:target.id},'student')).toEqual(first);
    record=(await database.query('select draft_profile_version_id,version from app_private.tutors where id=$1',[target.id])).rows[0];
    await rpc('approve_tutor_profile',{p_tutor_id:target.id,p_profile_version_id:record.draft_profile_version_id,p_decision:'rejected',p_reason:'Keep prior approved version',p_expected_version:record.version,p_idempotency_key:randomUUID()});
    expect(await rpc('get_public_tutor',{p_tutor_id:target.id},'student')).toEqual(first);
  });
});
