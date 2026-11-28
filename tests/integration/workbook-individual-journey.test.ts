import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { eligibleRequestOccurrence } from '../helpers/requests';
import { loadLocalSupabase } from '../helpers/supabase';
import { syntheticPdf, runFileScan } from '../helpers/files';
import { provisionFakeMeeting } from '../helpers/calendar';
import { settleTutorPayout } from '../helpers/payroll';
import { createFileContentService } from '../../src/server/files';
import { parseServerConfig } from '../../src/server/config';
import { invokeFileCommandWithStatus } from '../../src/modules/files/commands';
import { getMeetingAccess } from '../../src/modules/teaching/meetings';
import { getTutorStatement } from '../../src/modules/tutor_pay/payroll';

vi.mock('server-only', () => ({}));

test('J1 individual PDF request through tuition, lesson delivery and settled tutor payout', async () => {
  const f = await paymentFixture({isolatedLearners:true}), local = loadLocalSupabase();
  const worker = new Pool({connectionString: local.worker_database_url});
  const files = createFileContentService(worker, parseServerConfig({APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:local.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.publishable_key,SUPABASE_SECRET_KEY:local.secret_key}));
  const checksum = createHash('sha256').update(syntheticPdf).digest('hex');
  const key = () => ({p_idempotency_key:randomUUID()});
  async function upload(purpose: 'receipt' | 'request_material', parent: string) {
    const created = await invokeFileCommandWithStatus(f.learner, 'create_file_upload', {p_purpose:purpose,p_parent_id:parent,
      p_evidence_action:purpose === 'receipt' ? 'submit_receipt' : null,p_filename:'synthetic.pdf',p_declared_type:'application/pdf',p_size_bytes:syntheticPdf.length,p_checksum_sha256:checksum,...key()});
    const id = created.data.file_id;
    await files.upload(f.learner,id,syntheticPdf);
    const done = await invokeFileCommandWithStatus(f.learner,'finalize_file_upload',{p_file_id:id,p_checksum_sha256:checksum,...key()});
    expect(await runFileScan(done.data.scan_job_id)).toBe('completed');
    return id;
  }
  let organizer: string | undefined;
  try {
    const question = {p_topic:'Synthetic mechanics',p_course:'Independent study',p_description:'Explain the slide.',
      p_preferred_times:'Morning in Cairo',p_format:'individual'};
    const request = await f.rpc('create_tutoring_request',{...question,p_learner_id:f.learnerId,...key()},f.learner);
    const subject = {p_request_id:request.resource_id};
    const slide = await upload('request_material',request.resource_id as string);
    const sent = await f.rpc('submit_tutoring_request',{...subject,p_expected_version:request.version,...key()},f.learner);
    const more = await f.rpc('review_tutoring_request',{...subject,p_state:'needs_information',p_customer_reply:'Which example?',p_expected_version:sent.version,...key()},f.reviewer);
    const edited = await f.rpc('update_tutoring_request',{...subject,...question,p_description:'Please explain example two.',p_expected_version:more.version,...key()},f.learner);
    const resubmitted = await f.rpc('submit_tutoring_request',{...subject,p_expected_version:edited.version,...key()},f.learner);
    const occurrence = await eligibleRequestOccurrence(f);
    const lesson = {p_occurrence_id:occurrence.occurrence_id};
    const state = async () => (await f.database.query('select * from app_private.occurrences where id=$1',[lesson.p_occurrence_id])).rows[0];
    const initial = await state();
    await f.rpc('approve_tutor_fee',{...lesson,p_tutor_id:f.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:90,
      p_compensation_policy_version_id:initial.pricing_version_id,p_target_tier:null,p_purpose:'initial',p_reason:'Workbook test agreement',p_expected_version:initial.version,...key()});
    await f.rpc('review_tutoring_request',{...subject,...lesson,p_state:'matched',p_customer_reply:'Review your session.',p_expected_version:resubmitted.version,...key()},f.reviewer);
    const held = await f.reserve(lesson.p_occurrence_id as string);
    expect(held.customer_price_minor).toBe(65000);
    const quote = await f.rpc('get_quote',{p_quote_id:held.quote_id},f.learner);
    await f.rpc('accept_quote',{p_quote_id:held.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:quote.version,...key()},f.learner);
    const charge = (await f.database.query('select id from finance_private.charges where enrollment_id=$1',[held.enrollment_id])).rows[0].id;
    const receiving = await f.receiving();
    const receiptId = await upload('receipt',charge);
    const receipt = await f.rpc('submit_receipt',{p_enrollment_id:held.enrollment_id,p_charge_id:charge,p_file_id:receiptId,
      p_receiving_account_version_id:receiving.versionId,p_channel:'instapay',p_transferred_amount_minor:65000,p_currency:'EGP',
      p_reference:'Synthetic transfer reference',p_transferred_at:null,...key()},f.learner);
    const transfer = await f.transfer(receiving.id,65000);
    const claim = await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,...key()},f.reviewer);
    const added = await f.rpc('add_fake_calendar_organizer',key());
    organizer = added.connection_id as string;
    await f.database.query("update app_private.provider_connections set organizer_email=$2 where id=$1 and mode='fake'",[organizer,f.actor.email]);
    await f.rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,
      p_allocations:[{charge_id:charge,amount_minor:65000}],p_expected_version:claim.version,...key()},f.reviewer);
    const funded = await state();
    if (funded.state !== 'confirmed') await f.rpc('confirm_occurrence',{...lesson,p_expected_version:funded.version,...key()});
    expect((await state()).state).toBe('confirmed');
    expect(Buffer.from((await files.download(f.tutor,slide)).bytes)).toEqual(syntheticPdf);
    await expect(files.download(f.students[1],slide)).rejects.toThrow('NOT_FOUND');
    expect((await f.students[1].rpc('get_enrollment',{p_enrollment_id:held.enrollment_id})).error?.message).toBe('NOT_FOUND');
    await provisionFakeMeeting(f,lesson.p_occurrence_id as string);
    await expect(getMeetingAccess(f.students[1],lesson.p_occurrence_id as string,{view:'customer',learner_id:f.learners[1]})).rejects.toThrow();
    // Move only the dedicated test occurrence's schedule to exercise the provider and delivery windows.
    async function shiftStart(minutesAgo:number) {
      return (await f.database.query(`update app_private.occurrences set start_at=date_trunc('second',now())-make_interval(mins=>$2),
        end_at=date_trunc('second',now())-make_interval(mins=>$2)+interval '90 minutes' where id=$1 returning start_at,end_at,version`,[lesson.p_occurrence_id,minutesAgo])).rows[0];
    }
    await shiftStart(1);
    const room = await getMeetingAccess(f.tutor,lesson.p_occurrence_id as string,{view:'tutor'});
    expect(new URL(room.join_url).hostname).toBe('meet.example.test');
    const elapsed = await shiftStart(95);
    const actual = {p_actual_start_at:elapsed.start_at.toISOString(),p_actual_end_at:elapsed.end_at.toISOString()};
    const started = await f.rpc('start_occurrence',{...lesson,p_actual_start_at:actual.p_actual_start_at,p_expected_version:elapsed.version,...key()},f.tutor);
    const attendance = await f.rpc('record_attendance',{...lesson,...actual,p_entries:[{enrollment_id:held.enrollment_id,attendance:'present',attended_seconds:5400,reason:null}],p_expected_version:started.version,...key()},f.tutor);
    const submitted = await f.rpc('submit_completion',{...lesson,p_attendance_version:attendance.attendance_version,p_topic_summary:'Synthetic delivery',
      p_delivery_exception_ids:[],p_expected_version:attendance.version,...key()},f.tutor);
    const approved = await f.rpc('approve_completion',{...lesson,p_completion_version:1,p_approved_remedy_ids:[],p_expected_version:submitted.version,...key()});
    for (const learner of [null,f.learnerId]) await f.rpc('publish_learning_record',{...lesson,p_learner_id:learner,
      p_content:learner?'Practice example two.':'Class summary for mechanics.',p_expected_version:0,...key()},f.tutor);
    const published = await f.rpc('get_learning_records',{...lesson,p_view:'customer',p_learner_id:f.learnerId},f.learner);
    expect(published).toMatchObject({group_summary:{content:'Class summary for mechanics.'},feedback:[{content:'Practice example two.'}]});
    expect(await getTutorStatement(f.tutor)).toMatchObject({earned_minor:25000,settled_minor:0});
    await settleTutorPayout({...f,receivingAccount:receiving},approved.base_earning_id as string,25000);
    expect(await getTutorStatement(f.tutor)).toMatchObject({earned_minor:25000,settled_minor:25000,owed_minor:0});
  } finally {
    try {
      if (organizer) {
        const {rows:[connection]} = await f.database.query('select state,version from app_private.provider_connections where id=$1',[organizer]);
        if (connection?.state==='connected') await f.rpc('revoke_calendar_connection',{p_connection_id:organizer,p_expected_version:connection.version,...key()});
      }
    } finally { await worker.end(); await f.close(); }
  }
},120000);
