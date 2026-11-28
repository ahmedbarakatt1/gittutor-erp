import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { expect, test, vi } from 'vitest';
import { parseServerConfig } from '../../src/server/config';
import { createFileContentService, createPrivateObjectStore } from '../../src/server/files';
import { getSessionQuizzes, listMyQuizResults } from '../../src/modules/teaching/quizzes';
import { raceBookingCalls } from '../helpers/booking';
import { runFileScan, syntheticPdf } from '../helpers/files';
import { groupRemovalFixture } from '../helpers/group-removal';
import { anonymousClient, loadLocalSupabase } from '../helpers/supabase';
vi.mock('server-only', () => ({}));

test('assigned tutor publishes a scanned quiz, grades a confirmed roster, and each learner sees only their grades', async () => {
  const f = await groupRemovalFixture(3), config = loadLocalSupabase();
  const worker = new Pool({ connectionString: config.worker_database_url });
  const server = parseServerConfig({ APP_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: config.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishable_key, SUPABASE_SECRET_KEY: config.secret_key });
  const files = createFileContentService(worker, server, createPrivateObjectStore(server));
  const guardian = anonymousClient();
  try {
    const checksum = createHash('sha256').update(syntheticPdf).digest('hex');
    const intent = { p_parent_id: f.occurrenceId, p_purpose: 'shared_handout', p_filename: 'practice.pdf', p_declared_type: 'application/pdf',
      p_size_bytes: syntheticPdf.length, p_checksum_sha256: checksum, p_evidence_action: null, p_idempotency_key: randomUUID() };
    const fileId = (await f.rpc('create_file_upload', intent, f.tutor)).file_id as string;
    const create = { p_occurrence_id: f.occurrenceId, p_file_id: fileId, p_title: 'Quiz on linear equations', p_max_score: 10, p_idempotency_key: randomUUID() };
    const wrongFile = await f.rpc('create_file_upload', { ...intent, p_filename: 'image.png', p_declared_type: 'image/png', p_idempotency_key: randomUUID() }, f.tutor);
    expect((await f.tutor.rpc('create_session_quiz', { ...create, p_file_id: wrongFile.file_id })).error?.message).toBe('FILE_TYPE_INVALID');
    const other = await f.occurrence();
    expect((await f.tutor.rpc('create_session_quiz', { ...create, p_occurrence_id: other.occurrence_id })).error?.message).toBe('NOT_FOUND');
    expect((await f.tutor.rpc('create_session_quiz', create)).error?.message).toBe('SCAN_REQUIRED');
    await files.upload(f.tutor, fileId, syntheticPdf);
    const finalize = await f.rpc('finalize_file_upload', { p_file_id: fileId, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() }, f.tutor);
    expect((await f.tutor.rpc('create_session_quiz', create)).error?.message).toBe('SCAN_REQUIRED');
    expect(await runFileScan(finalize.scan_job_id as string)).toBe('completed');
    for (const unauthorized of [f.students[0], f.reviewer, f.admin]) {
      expect((await unauthorized.rpc('create_session_quiz', create)).error?.message).toBe('FORBIDDEN');
    }
    const assigned = await f.rpc('create_session_quiz', create, f.tutor);
    const quizId = assigned.quiz_id as string;
    expect(await f.rpc('create_session_quiz', create, f.tutor)).toEqual(assigned);
    expect((await f.tutor.rpc('create_session_quiz', { ...create, p_max_score: 12 })).error?.message).toBe('IDEMPOTENCY_CONFLICT');
    expect((await f.tutor.rpc('create_session_quiz', { ...create, p_idempotency_key: randomUUID() })).error?.message).toBe('STATE_CONFLICT');
    const customerSession = (i: number) => getSessionQuizzes(f.students[i], f.occurrenceId, { view: 'customer', learner_id: f.learners[i] });
    expect(await customerSession(0)).toMatchObject({ quizzes: [{ quiz_id: quizId, grade: null, content_path: `/api/v1/files/${fileId}/content` }] });
    expect(Buffer.from((await files.download(f.students[0], fileId)).bytes)).toEqual(syntheticPdf);
    await expect(customerSession(3)).rejects.toThrow('NOT_FOUND');
    await expect(files.download(f.students[3], fileId)).rejects.toThrow('NOT_FOUND');
    const grade = { p_quiz_id: quizId, p_learner_id: f.learners[0], p_score: 0, p_expected_version: 0, p_idempotency_key: randomUUID() };
    for (const unauthorized of [f.students[1], f.reviewer, f.admin]) {
      expect((await unauthorized.rpc('record_quiz_grade', grade)).error?.message).toBe('FORBIDDEN');
    }
    for (const invalid of [-0.01, 10.01, 6.666]) {
      expect((await f.tutor.rpc('record_quiz_grade', { ...grade, p_score: invalid })).error?.message).toBe('VALIDATION_ERROR');
    }
    expect((await f.tutor.rpc('record_quiz_grade', { ...grade, p_learner_id: f.learners[3] })).error?.message).toBe('NOT_FOUND');
    const zero = await f.rpc('record_quiz_grade', grade, f.tutor);
    expect(zero).toMatchObject({ score: 0, version: 1 });
    expect(await f.rpc('record_quiz_grade', grade, f.tutor)).toEqual(zero);
    expect((await f.tutor.rpc('record_quiz_grade', { ...grade, p_score: 1 })).error?.message).toBe('IDEMPOTENCY_CONFLICT');
    expect(await customerSession(0)).toMatchObject({ quizzes: [{ grade: { score: 0, version: 1 } }] });
    expect(await customerSession(1)).toMatchObject({ quizzes: [{ grade: null }] });
    await expect(getSessionQuizzes(f.students[1], f.occurrenceId, { view: 'customer', learner_id: f.learners[0] })).rejects.toThrow('NOT_FOUND');
    const race = await raceBookingCalls([6.25, 8].map(score => ({
      client: f.tutor, name: 'record_quiz_grade', args: { ...grade, p_score: score, p_expected_version: 1, p_idempotency_key: randomUUID() },
    })));
    expect(race.filter(entry => entry.error === 'VERSION_CONFLICT')).toHaveLength(1);
    const saved = race.find(entry => entry.data)?.data;
    expect(saved).toMatchObject({ version: 2 });
    const tutorSession = await getSessionQuizzes(f.tutor, f.occurrenceId, { view: 'tutor' });
    expect(tutorSession).toMatchObject({ roster: expect.arrayContaining(f.learners.slice(0, 3).map(learner_id => expect.objectContaining({ learner_id }))),
      quizzes: [{ quiz_id: quizId, grades: [{ learner_id: f.learners[0], score: saved.score, version: 2 }] }] });

    const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `quiz.${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}!`;
    const created = await provider.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('QUIZ_GUARDIAN_FIXTURE_FAILED');
    expect((await guardian.auth.signInWithPassword({ email, password })).error).toBeNull();
    const contact = (await f.database.query('select id from app_private.verified_contacts where account_id=$1 and revoked_at is null', [created.data.user.id])).rows[0].id;
    async function link(i: number, scopes: string[]) {
      const invitation = await f.rpc('create_guardian_invitation', { p_contact_id: contact, p_scopes: scopes,
        p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID() }, f.students[i]);
      const event = await f.database.query("select payload->>'single_use_token' as token from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [invitation.invitation_id]);
      return f.rpc('accept_guardian_invitation', { p_invitation_id: invitation.invitation_id, p_single_use_token: event.rows[0].token,
        p_expected_version: 1, p_idempotency_key: randomUUID() }, guardian);
    }
    const first = await link(0, ['materials']);
    await link(1, ['materials']);
    await link(2, ['booking']);
    const page1 = await listMyQuizResults(guardian, { limit: 1 });
    expect(page1.next_cursor).toEqual(expect.any(String));
    const page2 = await listMyQuizResults(guardian, { limit: 1, cursor: page1.next_cursor });
    const both = [...page1.items, ...page2.items];
    expect(both.map(row => row.quiz_id)).toEqual([quizId, quizId]);
    expect(new Set(both.map(row => row.learner_id))).toEqual(new Set(f.learners.slice(0, 2)));
    expect(both.find(row => row.learner_id === f.learners[0])?.grade).toEqual({ score: saved.score, version: 2 });
    expect(both.find(row => row.learner_id === f.learners[1])?.grade).toBeNull();
    expect((await listMyQuizResults(guardian, { learner_id: f.learners[0] })).items.every(row => row.learner_id === f.learners[0])).toBe(true);
    await expect(listMyQuizResults(guardian, { learner_id: f.learners[2] })).rejects.toThrow('NOT_FOUND');
    await f.rpc('revoke_guardian_link', { p_guardian_link_id: first.guardian_link_id, p_expected_version: 1, p_reason: 'End learning access', p_idempotency_key: randomUUID() }, f.students[0]);
    await expect(listMyQuizResults(guardian, { learner_id: f.learners[0] })).rejects.toThrow('NOT_FOUND');
    expect((await listMyQuizResults(guardian)).items.every(row => row.learner_id === f.learners[1])).toBe(true);
    const published = await f.rpc('get_file', { p_file_id: fileId }, f.tutor);
    await f.rpc('withdraw_shared_file', { p_file_id: fileId, p_expected_version: published.version,
      p_reason: 'Replace question sheet', p_idempotency_key: randomUUID() }, f.tutor);
    expect(await customerSession(0)).toMatchObject({ quizzes: [{ content_path: null, grade: { score: saved.score } }] });
    await expect(files.download(f.students[0], fileId)).rejects.toThrow('NOT_FOUND');
    await f.database.query('update app_private.tutor_assignments set active=false where occurrence_id=$1 and active', [f.occurrenceId]);
    await expect(getSessionQuizzes(f.tutor, f.occurrenceId, { view: 'tutor' })).rejects.toThrow('NOT_FOUND');
    expect((await f.tutor.rpc('record_quiz_grade', grade)).error?.message).toBe('NOT_FOUND');
    await expect(files.download(f.tutor, fileId)).rejects.toThrow('NOT_FOUND');
  } finally {
    await guardian.auth.signOut({ scope: 'local' }); await worker.end(); await f.close();
  }
}, 120000);
