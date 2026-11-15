import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
import { invokeFileCommandWithStatus } from '../../src/modules/files/commands';
import { getFile, listFiles } from '../../src/modules/files/queries';
import { parseServerConfig } from '../../src/server/config';
import { createFileContentService, createPrivateObjectStore } from '../../src/server/files';
import { bookingFixture, raceBookingCalls } from '../helpers/booking';
import { runFileScan, syntheticPdf } from '../helpers/files';
import { requestFixture } from '../helpers/requests';
import { anonymousClient, authClient, loadLocalSupabase } from '../helpers/supabase';

vi.mock('server-only', () => ({}));

const details = {
  p_topic: 'Photovoltaic panel diagnostics', p_course: 'Independent study',
  p_description: 'Work through the example on slide 4.',
  p_preferred_times: 'Monday after 18:00 Africa/Cairo', p_format: 'undecided',
};

test('private request drafts enforce current scope, retries and concurrent versions', async () => {
  const f = await bookingFixture();
  const guardian = await authClient('guardian_a');
  try {
    const [learner, unrelated] = f.students;
    const input = { ...details, p_learner_id: f.learners[0], p_idempotency_key: randomUUID() };
    const first = await learner.rpc('create_tutoring_request', input);
    expect(first.error).toBeNull();
    expect(first.status).toBe(201);
    expect((await learner.rpc('create_tutoring_request', input)).data).toEqual(first.data);
    expect((await learner.rpc('create_tutoring_request', { ...input, p_topic: 'Changed' })).error?.message).toBe('IDEMPOTENCY_CONFLICT');
    expect((await unrelated.rpc('create_tutoring_request', input)).error?.message).toBe('NOT_FOUND');
    expect((await anonymousClient().rpc('create_tutoring_request', input)).error).not.toBeNull();
    const guest = anonymousClient();
    expect((await guest.auth.signInAnonymously()).error).toBeNull();
    try {
      expect((await guest.rpc('create_tutoring_request', input)).error?.message).toBe('VERIFIED_ACCOUNT_REQUIRED');
      expect((await guest.rpc('create_file_upload', { p_purpose: 'request_material', p_parent_id: first.data.resource_id,
        p_filename: 'guest.pdf', p_declared_type: 'application/pdf', p_size_bytes: 200, p_checksum_sha256: '0'.repeat(64),
        p_evidence_action: null, p_idempotency_key: randomUUID() })).error?.message).toBe('VERIFIED_ACCOUNT_REQUIRED');
    } finally { await guest.auth.signOut({ scope: 'local' }); }
    expect((await f.database.query("select has_table_privilege('authenticated','app_private.tutoring_requests','select') as read, has_table_privilege('authenticated','app_private.tutoring_request_file_removals','insert') as write")).rows[0]).toEqual({ read: false, write: false });
    const sameKey = { name: 'create_tutoring_request', client: learner, args: { ...input, p_idempotency_key: randomUUID() } };
    const retries = await raceBookingCalls([sameKey, sameKey]);
    expect(retries[0].error).toBeNull();
    expect(retries[1]).toEqual(retries[0]);
    const id = first.data.resource_id;
    const args = { p_request_id: id };
    for (const client of [unrelated, guardian, f.admin, f.tutor]) {
      expect((await client.rpc('get_tutoring_request', args)).error?.message).toBe('NOT_FOUND');
    }
    expect((await f.admin.rpc('list_tutoring_request_queue')).data.items).not.toContainEqual(expect.objectContaining({ request_id: id }));
    const draft = await learner.rpc('get_tutoring_request', args);
    expect(draft.data).toMatchObject({ request_id: id, topic: details.p_topic, state: 'draft', can_edit: true, files: [], matched_session: null });
    const concurrent = await raceBookingCalls(['First review topic', 'Second review topic'].map(topic => ({
      name: 'update_tutoring_request', client: learner,
      args: { ...args, ...details, p_topic: topic, p_expected_version: 1, p_idempotency_key: randomUUID() },
    })));
    expect(concurrent.filter(result => result.data?.version === 2)).toHaveLength(1);
    expect(concurrent.filter(result => result.error === 'VERSION_CONFLICT')).toHaveLength(1);
    const guarded = await guardian.rpc('create_tutoring_request', { ...input, p_idempotency_key: randomUUID() });
    expect(guarded.error).toBeNull();
    const guardedId = guarded.data.resource_id;
    expect((await learner.rpc('update_tutoring_request', { ...details, p_request_id: guardedId, p_expected_version: 1, p_idempotency_key: randomUUID() })).error?.message).toBe('NOT_FOUND');
    const original = (await f.database.query('select id,scopes from app_private.guardian_links where learner_id=$1 and guardian_account_id=$2 and revoked_at is null', [f.learners[0], loadLocalSupabase().actors.guardian_a.id])).rows[0];
    try {
      await f.database.query("update app_private.guardian_links set scopes=array['materials'] where id=$1", [original.id]);
      expect((await guardian.rpc('get_tutoring_request', { p_request_id: guardedId })).error?.message).toBe('NOT_FOUND');
      expect((await guardian.rpc('create_tutoring_request', { ...input, p_idempotency_key: randomUUID() })).error?.message).toBe('NOT_FOUND');
    } finally {
      await f.database.query('update app_private.guardian_links set scopes=$2 where id=$1', [original.id, original.scopes]);
    }
  } finally {
    await guardian.auth.signOut({ scope: 'local' });
    await f.close();
  }
});

test('a request waits for clean private bytes and staff matching creates no booking', async () => {
  const f = await requestFixture();
  const config = loadLocalSupabase();
  const worker = new Pool({ connectionString: config.worker_database_url });
  const server = parseServerConfig({ APP_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishable_key, SUPABASE_SECRET_KEY: config.secret_key });
  const content = createFileContentService(worker, server, createPrivateObjectStore(server));
  try {
    const [learner, unrelated] = f.students;
    const staff = await authClient('cs_a');
    try {
      const created = await f.rpc('create_tutoring_request', { ...details, p_learner_id: f.learners[0], p_idempotency_key: randomUUID() }, learner);
      const requestId = created.resource_id as string;
      const args = { p_request_id: requestId };
      const submit = { ...args, p_expected_version: 1, p_idempotency_key: randomUUID() };
      expect((await learner.rpc('submit_tutoring_request', submit)).error?.message).toBe('EVIDENCE_REQUIRED');
      const checksum = createHash('sha256').update(syntheticPdf).digest('hex');
      const declaration = { p_purpose: 'request_material', p_parent_id: requestId, p_evidence_action: null, p_filename: 'synthetic.pdf', p_declared_type: 'application/pdf', p_size_bytes: syntheticPdf.length, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() };
      await expect(invokeFileCommandWithStatus(unrelated, 'create_file_upload', declaration)).rejects.toThrow('NOT_FOUND');
      const makeFile = async (scenario?: string) => {
        const { data: { file_id } } = await invokeFileCommandWithStatus(learner, 'create_file_upload', { ...declaration, p_idempotency_key: randomUUID() });
        await content.upload(learner, file_id, syntheticPdf);
        if (scenario) await f.database.query('insert into app_private.file_scan_scenarios(file_id,scenario) values($1,$2)', [file_id, scenario]);
        const result = await invokeFileCommandWithStatus(learner, 'finalize_file_upload', { p_file_id: file_id, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
        expect((await learner.rpc('submit_tutoring_request', submit)).error?.message).toBe('SCAN_REQUIRED');
        expect(await runFileScan(result.data.scan_job_id)).toBe('completed');
        return file_id;
      };
      const quarantinedId = await makeFile('infected');
      expect((await learner.rpc('submit_tutoring_request', submit)).error?.message).toBe('SCAN_REQUIRED');
      const fileId = await makeFile();
      expect((await learner.rpc('submit_tutoring_request', submit)).error?.message).toBe('SCAN_REQUIRED');
      const detach = { ...args, p_file_id: quarantinedId, p_expected_version: 1, p_idempotency_key: randomUUID() };
      expect((await learner.rpc('remove_tutoring_request_file', detach)).data.version).toBe(2);
      expect((await learner.rpc('remove_tutoring_request_file', detach)).data.version).toBe(2);
      await expect(getFile(learner, quarantinedId)).rejects.toThrow('NOT_FOUND');
      await expect(content.upload(learner, quarantinedId, syntheticPdf)).rejects.toThrow('NOT_FOUND');
      await expect(getFile(staff, fileId)).rejects.toThrow('NOT_FOUND');
      const submitCurrent = { ...submit, p_expected_version: 2 };
      expect((await learner.rpc('submit_tutoring_request', submitCurrent)).data.version).toBe(3);
      expect((await learner.rpc('submit_tutoring_request', submitCurrent)).data.version).toBe(3);
      await expect(invokeFileCommandWithStatus(learner, 'create_file_upload', declaration)).rejects.toThrow('STATE_CONFLICT');
      expect(Buffer.from((await content.download(staff, fileId)).bytes)).toEqual(syntheticPdf);
      await expect(content.download(staff, quarantinedId)).rejects.toThrow('NOT_FOUND');
      await expect(content.download(f.tutor, fileId)).rejects.toThrow('NOT_FOUND');

      const followUp = await f.rpc('review_tutoring_request', { ...args, p_state: 'needs_information', p_customer_reply: 'Which exercise needs review?', p_expected_version: 3, p_idempotency_key: randomUUID() }, staff);
      expect(followUp.version).toBe(4);
      const updated = await f.rpc('update_tutoring_request', { ...args, ...details, p_description: 'Please review exercise 3.', p_expected_version: 4, p_idempotency_key: randomUUID() }, learner);
      expect(updated.version).toBe(5);
      expect((await f.rpc('submit_tutoring_request', { ...args, p_expected_version: 5, p_idempotency_key: randomUUID() }, learner)).version).toBe(6);

      await f.availability();
      const earlierOffer = await f.occurrence();
      const occurrence = await f.eligibleOccurrence();
      expect((await learner.rpc('list_tutoring_request_matches', args)).error?.message).toBe('FORBIDDEN');
      const candidates = await staff.rpc('list_tutoring_request_matches', { ...args, p_limit: 100 });
      expect(candidates.error).toBeNull();
      expect(candidates.data.items).toContainEqual(expect.objectContaining({ occurrence_id: occurrence.occurrence_id }));
      expect(candidates.data.items).not.toContainEqual(expect.objectContaining({ occurrence_id: earlierOffer.occurrence_id }));
      const review = { ...args, p_state: 'matched', p_customer_reply: 'Review the proposed time.', p_occurrence_id: occurrence.occurrence_id, p_expected_version: 6, p_idempotency_key: randomUUID() };
      expect((await learner.rpc('review_tutoring_request', review)).error?.message).toBe('FORBIDDEN');
      expect((await staff.rpc('review_tutoring_request', { ...review, p_occurrence_id: earlierOffer.occurrence_id })).error?.message).toBe('NOT_FOUND');
      expect((await staff.rpc('review_tutoring_request', review)).data.version).toBe(7);
      const visible = (await learner.rpc('get_tutoring_request', args)).data;
      expect(visible).toMatchObject({ state: 'matched', can_review: false, customer_reply: review.p_customer_reply, matched_session: { occurrence_id: occurrence.occurrence_id } });
      expect(JSON.stringify(visible)).not.toMatch(/object_key|owner_account_id|tutor_fee|compensation|checksum_sha256/);
      expect((await f.database.query('select count(*)::int n from app_private.enrollments where occurrence_id=$1', [occurrence.occurrence_id])).rows[0].n).toBe(0);
      await expect(content.download(f.tutor, fileId)).rejects.toThrow('NOT_FOUND');
      const reserved = await f.reserve(occurrence.occurrence_id as string);
      const list = { enrollment_id: reserved.enrollment_id as string, purpose: 'request_material' as const };
      expect((await listFiles(learner, list)).items.map(file => file.file_id)).toEqual([fileId]);
      expect((await listFiles(f.tutor, list)).items).toEqual([]);
      await expect(listFiles(unrelated, list)).rejects.toThrow('NOT_FOUND');
      await expect(content.download(f.tutor, fileId)).rejects.toThrow('NOT_FOUND');
      // Set only the isolated fixture's enrollment fact to exercise the independent download boundary.
      await f.database.query("update app_private.enrollments set state='confirmed' where id=$1", [reserved.enrollment_id]);
      try {
        expect(Buffer.from((await content.download(f.tutor, fileId)).bytes)).toEqual(syntheticPdf);
        expect((await listFiles(f.tutor, list)).items).toMatchObject([{ file_id: fileId, can_download: true }]);
        await f.database.query('update app_private.tutor_assignments set active=false where occurrence_id=$1', [occurrence.occurrence_id]);
        await expect(content.download(f.tutor, fileId)).rejects.toThrow('NOT_FOUND');
        await expect(listFiles(f.tutor, list)).rejects.toThrow('NOT_FOUND');
      } finally {
        await f.database.query('update app_private.tutor_assignments set active=true where occurrence_id=$1', [occurrence.occurrence_id]);
        await f.database.query("update app_private.enrollments set state='held' where id=$1", [reserved.enrollment_id]);
      }
    } finally { await staff.auth.signOut({ scope: 'local' }); }
  } finally {
    await worker.end();
    await f.close();
  }
}, 60000);
