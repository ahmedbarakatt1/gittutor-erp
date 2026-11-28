import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { anonymousClient, authClient } from '../helpers/supabase';
import { getConversation } from '../../src/modules/support/commands';
import { catalogFixtureIds } from '../../tools/catalog-seed';

test('J3 a released individual seat promotes the first waiting learner and accepts their EGP 650 quote', async () => {
  const f = await bookingFixture();
  try {
    await f.availability();
    const times = f.interval(9);
    const occurrence = await f.rpc('create_occurrence', {
      p_offer_id: catalogFixtureIds.individual_offer, p_tutor_id: f.tutorId, p_start_at: times.start_at,
      p_end_at: new Date(Date.parse(times.start_at) + 90 * 60000).toISOString(),
      p_time_zone: 'Africa/Cairo', p_target_tier: null, p_idempotency_key: randomUUID(),
    });
    const id = String(occurrence.occurrence_id);
    const held = await f.reserve(id);
    const first = await f.rpc('get_enrollment', {p_enrollment_id: held.enrollment_id}, f.students[0]);
    expect(first).toMatchObject({state:'held',quote:{customer_price_minor:65000}});
    const waiting = await f.rpc('join_waitlist', {p_occurrence_id:id,p_learner_id:f.learners[1],p_idempotency_key:randomUUID()}, f.students[1]);
    const entry = await f.database.query('select state from app_private.waitlist_entries where id=$1',[waiting.waitlist_entry_id]);
    expect(entry.rows[0]).toMatchObject({state:'waiting'});
    const before = await f.rpc('list_my_waitlist', {p_learner_id:f.learners[1],p_state:'waiting',p_limit:100},f.students[1]);
    expect(before.items).toContainEqual(expect.objectContaining({waitlist_entry_id:waiting.waitlist_entry_id,position:1}));
    await f.rpc('cancel_enrollment',{p_enrollment_id:held.enrollment_id,p_reason:'Synthetic release',p_remedy_proposal_id:null,p_expected_version:first.version,p_idempotency_key:randomUUID()},f.students[0]);
    expect(await f.rpc('get_enrollment',{p_enrollment_id:held.enrollment_id},f.students[0])).toMatchObject({state:'cancelled'});
    await f.database.query('select app_private.process_occurrence_booking_due($1,$2)',[id,randomUUID()]);
    const offered = (await f.database.query('select state,offered_enrollment_id from app_private.waitlist_entries where id=$1',[waiting.waitlist_entry_id])).rows[0];
    expect(offered.state).toBe('offered');
    const reservation = await f.rpc('get_enrollment',{p_enrollment_id:offered.offered_enrollment_id},f.students[1]);
    const quote = reservation.quote as { quote_id:string; quote_hash:string; version:number; customer_price_minor:number; expires_at:string };
    expect(quote.customer_price_minor).toBe(65000);
    expect(Date.parse(quote.expires_at)).toBeGreaterThan(Date.now());
    await f.rpc('accept_quote',{p_quote_id:quote.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:quote.version,p_idempotency_key:randomUUID()},f.students[1]);
    expect(await f.rpc('get_enrollment',{p_enrollment_id:offered.offered_enrollment_id},f.students[1])).toMatchObject({state:'held',learner:{learner_id:f.learners[1]},quote:{accepted_at:expect.any(String)}});
  } finally { await f.close(); }
},90000);

test('J7 visitor hands off and links the same website conversation, service escalates and admin resolves', async () => {
  const f = await bookingFixture(), guest = anonymousClient(), staff = await authClient('cs_a');
  try {
    expect((await guest.auth.signInAnonymously()).error).toBeNull();
    const made = await f.rpc('start_conversation',{p_channel:'website',p_topic:'Synthetic support journey',p_source_token:null,p_idempotency_key:randomUUID()},guest);
    const id = String(made.conversation_id);
    await f.rpc('submit_message',{p_conversation_id:id,p_text:'I need a refund and a human',p_client_message_id:randomUUID(),p_idempotency_key:randomUUID()},guest);
    expect(await getConversation(guest,id)).toMatchObject({state:'waiting',bot_paused:true});
    const challenge = await f.rpc('issue_conversation_challenge',{p_conversation_id:id,p_idempotency_key:randomUUID()},guest);
    await f.rpc('link_conversation_account',{p_conversation_id:id,p_single_use_thread_challenge:challenge.single_use_thread_challenge,p_learner_id:f.learners[0],p_idempotency_key:randomUUID()},f.students[0]);
    expect((await getConversation(f.students[0],id)).conversation_id).toBe(id);
    const run = async (name:string, body:Record<string,unknown>, client=staff) => {
      const current = await getConversation(client,id);
      return f.rpc(name,{...body,p_conversation_id:id,p_expected_version:current.version,p_idempotency_key:randomUUID()},client);
    };
    await run('claim_conversation',{});
    const reply='We are reviewing your request in your account.';
    await run('reply_to_conversation',{p_text:reply,p_template_id:null,p_template_parameters:[]});
    const note='Synthetic escalation context only for staff.';
    await run('add_conversation_note',{p_private_note:note});
    await run('escalate_conversation',{p_private_reason:'Supervisor decision requested'});
    expect(await getConversation(f.admin,id)).toMatchObject({state:'escalated'});
    const customer = await getConversation(f.students[0],id);
    expect(customer.messages.some(message=>message.text===reply)).toBe(true);
    expect(JSON.stringify(customer)).not.toContain(note);
    await run('resolve_conversation',{p_resolution_code:'answered',p_private_note:'Reviewed and answered'},f.admin);
    const resolved=await getConversation(f.students[0],id);
    expect(resolved.state).toBe('resolved');
    expect(resolved.messages.some(message=>message.text===reply)).toBe(true);
    expect((await getConversation(f.admin,id)).private_notes?.some(entry=>entry.text===note)).toBe(true);
  } finally { await Promise.all([guest,staff].map(client=>client.auth.signOut({scope:'local'}))); await f.close(); }
},90000);

test('current private seed and each group offer produce the published per-learner price without compensation', async () => {
  const f=await bookingFixture();
  try {
    await f.availability();
    const tiers=[
      {offer:catalogFixtureIds.individual_offer,size:null,minutes:90,amount:65000},
      {offer:catalogFixtureIds.group2_offer,size:2,minutes:60,amount:57500},
      {offer:catalogFixtureIds.group3_offer,size:3,minutes:60,amount:55000},
      {offer:catalogFixtureIds.group4_offer,size:4,minutes:60,amount:50000},
    ];
    for(const tier of tiers) {
      const time=f.interval(),end=new Date(Date.parse(time.start_at)+tier.minutes*60_000).toISOString();
      const occurrence=await f.rpc('create_occurrence',{p_offer_id:tier.offer,p_tutor_id:f.tutorId,p_start_at:time.start_at,p_end_at:end,p_time_zone:'Africa/Cairo',p_target_tier:tier.size,p_idempotency_key:randomUUID()});
      const held=await f.reserve(String(occurrence.occurrence_id));
      const enrollment=await f.rpc('get_enrollment',{p_enrollment_id:held.enrollment_id},f.students[0]);
      expect(enrollment).toMatchObject({quote:{currency:'EGP',customer_price_minor:tier.amount}});
      expect(JSON.stringify(enrollment)).not.toMatch(/fee_minor|tutor_fee|fee_agreement|compensation|margin_minor/);
    }
  } finally { await f.close(); }
},90000);
