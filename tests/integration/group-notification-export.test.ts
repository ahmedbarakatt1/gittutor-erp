import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect,test,vi } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { exportInfrastructure, renderExport } from '../helpers/exports';
import { exportSchemas } from '../../src/modules/crm/exports';
import { renderNotification } from '../../src/modules/notifications/templates';
import { createLocalEmailAdapter } from '../../src/server/providers/email';
import { loadLocalSupabase } from '../helpers/supabase';

vi.mock('server-only',()=>({}));

test('group learner, guardian and separate payer see scoped email and own-account export bytes', async () => {
  const f = await bookingFixture(), g = await bookingFixture(), p = await bookingFixture(), learner = await bookingFixture();
  const infra = exportInfrastructure(), directory = await mkdtemp(join(tmpdir(),'git-tutor-family-email-'));
  const mail = createLocalEmailAdapter(directory,true);
  try {
    await f.availability();
    const learnerId = (await f.database.query('select id from app_private.learners where account_id=$1',[learner.actor.id])).rows[0].id;
    for (const actor of [g,p]) {
      const {rows:[contact]}=await f.database.query('select id from app_private.verified_contacts where account_id=$1 and revoked_at is null',[actor.actor.id]);
      const invite=await f.rpc('create_guardian_invitation',{p_contact_id:contact.id,p_scopes:['profile','booking','payments','notifications'],p_expires_at:new Date(Date.now()+3600000).toISOString(),p_idempotency_key:randomUUID()},learner.tutor);
      const {rows:[event]}=await f.database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1",[invite.invitation_id]);
      await f.rpc('accept_guardian_invitation',{p_invitation_id:invite.invitation_id,p_single_use_token:event.payload.single_use_token,p_expected_version:1,p_idempotency_key:randomUUID()},actor.tutor);
    }
    const id=(await f.occurrence('group')).occurrence_id;
    const a=await f.rpc('reserve_enrollment',{p_occurrence_id:id,p_learner_id:learnerId,p_idempotency_key:randomUUID()},p.tutor);
    const b=await f.reserve(String(id),1);
    for (const [seat,owner] of [[a,p.tutor],[b,f.students[1]]] as const) {
      const quote=await f.rpc('get_quote',{p_quote_id:seat.quote_id},owner);
      await f.rpc('accept_quote',{p_quote_id:seat.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:quote.version,p_idempotency_key:randomUUID()},owner);
    }
    const charge=(await f.database.query('select id,responsible_account_id from finance_private.charges where enrollment_id=$1',[a.enrollment_id])).rows[0];
    expect(charge.responsible_account_id).toBe(p.actor.id);
    const event=randomUUID();
    await f.database.query("select app_private.enqueue_event($1,'payment_allocated',$2,$3,'notifications.route')",[event,charge.id,{charge_id:charge.id}]);
    const recipients=(await f.database.query('select * from app_private.notification_recipients($1)',[event])).rows;
    const config=loadLocalSupabase();
    expect(recipients.map(r=>r.account_id)).not.toContain(config.actors.learner_b.id);
    for(const [client,actor] of [[learner.tutor,learner.actor],[g.tutor,g.actor],[p.tutor,p.actor]] as const) {
      const projection=recipients.find(r=>r.account_id===actor.id && r.audience==='customer');
      expect(projection?.content.action_path).toBe('/learn/payments');
      const attempt=randomUUID();
      await mail.send({attempt_id:attempt,to:actor.email,...renderNotification(projection.content,'http://localhost:3000')});
      const message=JSON.parse(await readFile(join(directory,`${attempt}.json`),'utf8')).message;
      expect(message.text).toContain('/learn/payments');
      expect(message.to).toBe(actor.email);
      expect(JSON.stringify(message)).not.toContain(String(b.enrollment_id));
      const request={p_kind:'own_account',p_filters:{learner_ids:[learnerId]},p_columns:[...exportSchemas.own_account],p_as_of:new Date().toISOString(),p_idempotency_key:randomUUID()};
      const made=await f.rpc('request_export',request,client);
      expect(await renderExport(f.database,String(made.job_id))).toBe('completed');
      const csv=Buffer.from(await infra.download.download(client,String(made.export_id))).toString('utf8');
      expect(csv).toContain(String(a.enrollment_id));
      expect(csv).not.toContain(String(b.enrollment_id));
      expect(csv).not.toContain(f.learners[1]);
      expect(csv+JSON.stringify(message)).not.toMatch(/private_notes|margin_minor|tutor_fee|peer_feedback/);
      expect((await client.rpc('request_export',{...request,p_filters:{learner_ids:[f.learners[1]]},p_idempotency_key:randomUUID()})).error).not.toBeNull();
    }
  } finally { await infra.close(); await Promise.all([f.close(),g.close(),p.close(),learner.close()]); }
},150000);
