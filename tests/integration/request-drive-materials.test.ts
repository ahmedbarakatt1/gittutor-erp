import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { adminDatabase, loadLocalSupabase } from '../helpers/supabase';

test('only the restricted worker can inspect or acknowledge Drive mirror work', async () => {
  const db = await adminDatabase();
  try {
    const result = await db.query(`
      select role_name,
        has_function_privilege(role_name,'app_private.drive_material_work(uuid,uuid,integer)','execute') as work,
        has_function_privilege(role_name,'app_private.drive_material_finish(uuid,integer,boolean,text)','execute') as finish,
        has_function_privilege(role_name,'app_private.claim_request_material_scan(uuid)','execute') as scan,
        has_table_privilege(role_name,'app_private.request_drive_materials','select') as raw
      from unnest(array['anon','authenticated','service_role','git_tutor_worker']) role_name`);
    for (const row of result.rows) {
      expect(row).toMatchObject({ work: row.role_name === 'git_tutor_worker', finish: row.role_name === 'git_tutor_worker',
        scan: row.role_name === 'git_tutor_worker', raw: false });
    }
  } finally {
    await db.end();
  }
});

type SyntheticSession = { access_token: string };

test('new connected requests alone follow current enrollment, assignment, verified email, scans and removal', async () => {
  const fixture = await bookingFixture();
  const db = fixture.database;
  const [learner] = fixture.students;
  const requestArgs = [fixture.learners[0], 'Sample current', 'Sample course', 'Read an exercise', 'Monday', 'individual'];
  const learnerSession = (await learner.auth.getSession()).data.session!;
  const tutorSession = (await fixture.tutor.auth.getSession()).data.session!;
  const adminSession = (await fixture.admin.auth.getSession()).data.session!;
  const asSession = async (session: SyntheticSession) => {
    const claims = Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8');
    await db.query("select set_config('request.jwt.claims',$1,true)", [claims]);
  };
  const newRequest = async () => {
    const result = await db.query(`select api.create_tutoring_request(p_learner_id=>$1,p_topic=>$2,p_course=>$3,
      p_description=>$4,p_preferred_times=>$5,p_format=>$6,p_idempotency_key=>$7) as data`, [...requestArgs, randomUUID()]);
    return result.rows[0].data.resource_id as string;
  };
  const createIntent = async (requestId: string) => {
    const name = 'sample.pdf';
    const result = await db.query(`select api.create_file_upload('request_material',$1,$2,'application/pdf',100,
      repeat('a',64),null,$3) as data`, [requestId, name, randomUUID()]);
    return result.rows[0].data.file_id as string;
  };
  const finalize = async (fileId: string) => {
    // Synthetic immutable storage facts. These SQL checks exercise queue and entitlement;
    // requests.test.ts exercises the byte upload/download and scanner on local Storage.
    const attempt = randomUUID();
    await db.query(`insert into app_private.files(id,uploader_account_id,learner_id,parent_type,parent_id,purpose,
      object_key,object_version,checksum_sha256,detected_mime,byte_size,scan_state,source_provenance)
      select id,actor_id,learner_id,parent_type,parent_id,purpose,id::text,$2,checksum_sha256,declared_type,size_bytes,
        'pending','stored_object' from app_private.file_upload_intents where id=$1`, [fileId, attempt]);
    await db.query("insert into app_private.file_access_states(file_id,publication_state) values($1,'private')", [fileId]);
    await db.query("update app_private.file_upload_states set state='finalized',adopted_attempt_id=$2 where file_id=$1", [fileId, attempt]);
  };
  const due = async (request: string, file: string) => (await db.query(
    'select * from app_private.drive_material_work($1,$2,2)', [request, file])).rows;
  const queueScan = async (file: string) => {
    const result = await db.query(`select app_private.enqueue_event(gen_random_uuid(),'file_scan_requested',$1,
      jsonb_build_object('file_id',$1::uuid),'files.scan') as job`, [file]);
    await db.query('update app_private.file_upload_states set scan_job_id=$1 where file_id=$2', [result.rows[0].job,file]);
    return result.rows[0].job as string;
  };
  const project = async (file: string) => (await db.query(
    'select app_private.drive_material_projection($1) as data', [file])).rows[0].data;
  const finish = async (file: string, revision: number, email: string | null) => (await db.query(
    'select app_private.drive_material_finish($1,$2,true,$3) as ok', [file, revision, email])).rows[0].ok;
  const deniedLink = async (file: string) => {
    await db.query('savepoint link_check');
    try { await expect(db.query('select api.get_request_drive_link($1)', [file])).rejects.toThrow('NOT_FOUND'); }
    finally { await db.query('rollback to savepoint link_check'); }
  };
  try {
    await fixture.availability();
    const session = await fixture.occurrence();
    const enrollment = await fixture.reserve(session.occurrence_id as string);
    await db.query('begin');
    // A transaction-local fixture for the OAuth boundary avoids connecting any Google
    // account or writing a real address to local Auth; rollback restores its definition.
    await db.query(`create or replace function app_private.request_drive_connected() returns boolean language sql
      stable security definer set search_path='' as $$select coalesce(current_setting('test.drive_connected',true),'')='yes'$$`);
    await asSession(learnerSession);
    const historical = await newRequest();
    await db.query("select set_config('test.drive_connected','yes',true)");
    const oldFile = await createIntent(historical);
    await finalize(oldFile);
    expect(await project(oldFile)).toBeNull();
    const request = await newRequest();
    const file = await createIntent(request);
    expect(await project(file)).toBeNull();
    await finalize(file);
    await queueScan(oldFile);
    const scopedScan = await queueScan(file);
    expect((await db.query('select * from app_private.claim_request_material_scan($1)', [oldFile])).rows).toEqual([]);
    const claimed = (await db.query('select * from app_private.claim_request_material_scan($1)', [file])).rows;
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: scopedScan, aggregate_id: file, purpose: 'files.scan', attempt_count: 1 });
    expect((await db.query('select * from app_private.claim_request_material_scan($1)', [file])).rows).toEqual([]);
    const initial = await project(file);
    expect(initial).toMatchObject({ file_id: file, request_id: request, drive_file_id: null,
      copy_uploaded: false, want_copy: true, tutor_email: null, filename: 'sample.pdf', detected_type: 'application/pdf' });
    expect(await due(historical,file)).toEqual([]);
    expect(await due(request,file)).toEqual([{ file_id: file }]);
    const reserveId = async (id: string) => (await db.query(
      'select app_private.drive_material_reserve_id($1,$2) as id', [file,id])).rows[0].id;
    const remoteId = 'a'.repeat(256);
    expect(await reserveId(remoteId)).toBe(remoteId);
    expect(await reserveId('remote_two')).toBe(remoteId);
    expect(await finish(file,initial.revision,null)).toBe(false);
    expect((await db.query("select app_private.drive_material_mark_uploaded($1,'remote_two') ok", [file])).rows[0].ok).toBe(false);
    expect((await db.query('select app_private.drive_material_mark_uploaded($1,$2) ok', [file,remoteId])).rows[0].ok).toBe(true);
    expect(await finish(file,initial.revision,null)).toBe(true);
    expect(await due(request,file)).toEqual([]);
    await db.query("update app_private.tutoring_requests set state='matched',matched_occurrence_id=$2 where id=$1", [request,session.occurrence_id]);
    expect(await finish(file,initial.revision,null)).toBe(false);
    await db.query("update app_private.file_access_states set scan_state='clean',integration_state='verified' where file_id=$1", [file]);
    expect((await project(file)).tutor_email).toBeNull();
    await db.query("update app_private.enrollments set state='confirmed' where id=$1", [enrollment.enrollment_id]);
    const confirmed = await project(file);
    expect(confirmed.tutor_email).toBe(fixture.actor.email);
    await asSession(tutorSession);
    await deniedLink(file);
    expect(await finish(file,confirmed.revision,'unrelated@example.test')).toBe(false);
    expect(await finish(file,confirmed.revision,confirmed.tutor_email)).toBe(true);
    expect((await db.query('select api.get_request_drive_link($1) as data',[file])).rows[0].data).toEqual({drive_file_id:remoteId});
    await asSession(adminSession);
    await deniedLink(file);
    await asSession(learnerSession);
    await deniedLink(file);
    await asSession(tutorSession);
    await db.query("update auth.users set email='address-changed-'||id||'@example.test' where id=$1", [fixture.actor.id]);
    await deniedLink(file);
    const changed = await project(file);
    expect(changed.tutor_email).toBe('address-changed-'+fixture.actor.id+'@example.test');
    expect(await due(request,file)).toEqual([{file_id:file}]);
    expect(await finish(file,confirmed.revision,confirmed.tutor_email)).toBe(false);
    await db.query('update app_private.tutor_assignments set active=false where occurrence_id=$1', [session.occurrence_id]);
    expect((await project(file)).tutor_email).toBeNull();
    await db.query('update app_private.tutor_assignments set active=true where occurrence_id=$1', [session.occurrence_id]);
    await db.query("update app_private.account_roles set revoked_at=now() where role='tutor' and account_id=$1", [fixture.actor.id]);
    expect((await project(file)).tutor_email).toBeNull();
    await db.query("update app_private.file_access_states set scan_state='quarantined' where file_id=$1", [file]);
    expect(await project(file)).toMatchObject({want_copy:false,object_key:null,tutor_email:null});
    await db.query("update app_private.file_access_states set scan_state='clean' where file_id=$1", [file]);
    await db.query('insert into app_private.tutoring_request_file_removals(file_id) values($1)', [file]);
    const removed = await project(file);
    expect(removed).toMatchObject({want_copy:false,object_key:null,tutor_email:null});
    await db.query("select set_config('test.drive_connected','no',true)");
    expect(await project(file)).toBeNull();
    expect(await finish(file,removed.revision,null)).toBe(false);
  } finally {
    await db.query('rollback');
    await fixture.close();
  }
}, 30000);

test('independent workers reserve one remote file ID even while the first commit is pending', async () => {
  const fixture = await bookingFixture();
  const pool = new Pool({ connectionString: loadLocalSupabase().worker_database_url });
  const first = await pool.connect();
  const second = await pool.connect();
  let request: string | undefined;
  let file: string | undefined;
  try {
    const learner = fixture.students[0];
    const created = await fixture.rpc('create_tutoring_request', {
      p_learner_id: fixture.learners[0], p_topic: 'Parallel synthetic assignment', p_course: 'Sample',
      p_description: 'Inspect sample', p_preferred_times: 'Monday', p_format: 'individual', p_idempotency_key: randomUUID(),
    }, learner);
    request = String(created.resource_id);
    const intent = await fixture.rpc('create_file_upload', {
      p_parent_id: request, p_purpose: 'request_material', p_evidence_action: null, p_filename: 'example.pdf',
      p_size_bytes: 36, p_checksum_sha256: 'c'.repeat(64), p_declared_type: 'application/pdf', p_idempotency_key: randomUUID(),
    }, learner);
    file = String(intent.file_id);
    // Stage only this synthetic queue record. No shared Google account is connected for this test.
    await fixture.database.query('insert into app_private.request_drive_requests(request_id) values($1)', [request]);
    await fixture.database.query('insert into app_private.request_drive_materials(file_id,request_id) values($1,$2)', [file,request]);
    await first.query('begin');
    const reserve = 'select app_private.drive_material_reserve_id($1,$2) as id';
    expect((await first.query(reserve,[file,'first_id'])).rows[0].id).toBe('first_id');
    const { pid } = (await second.query('select pg_backend_pid() as pid')).rows[0];
    const competing = second.query(reserve,[file,'second_id']);
    try {
      await expect.poll(async () => (await fixture.database.query(
        'select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting).toBe(true);
      await first.query('commit');
      expect((await competing).rows[0].id).toBe('first_id');
    } finally {
      await first.query('rollback');
      await competing;
    }
  } finally {
    await first.query('rollback');
    first.release();
    second.release();
    await pool.end();
    if (file) await fixture.database.query('delete from app_private.request_drive_materials where file_id=$1', [file]);
    if (request) await fixture.database.query('delete from app_private.request_drive_requests where request_id=$1', [request]);
    await fixture.close();
  }
}, 30000);
