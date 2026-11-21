import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { findTeachingOperationReadRoute, teachingOperationRoutes } from '../../src/server/teaching-operations-http';
import { invokeTeachingCommandWithStatus } from '../../src/modules/teaching/operations';

const quiz = { quiz_id: randomUUID(), title: 'Derivatives', file_id: randomUUID(), filename: 'quiz.pdf', max_score: 10, content_path: null };
const occurrence = randomUUID(), learner = randomUUID();

test('tutor quiz publishing and grading accept only their scoped, typed fields', async () => {
  const create = teachingOperationRoutes.find(r => r.pattern.test(`occurrences/${occurrence}/quizzes`));
  const grade = teachingOperationRoutes.find(r => r.pattern.test(`quizzes/${quiz.quiz_id}/grades`));
  expect(create?.fields).toEqual(['title', 'file_id', 'max_score']);
  expect(grade?.fields).toEqual(['learner_id', 'score', 'expected_version']);
  const rpc = vi.fn();
  const args = { p_quiz_id: quiz.quiz_id, p_learner_id: learner, p_score: 0, p_expected_version: 0, p_idempotency_key: randomUUID() };
  for (const change of [{ p_score: -1 }, { p_score: 0.001 }, { p_score: 10001 }, { p_expected_version: -1 }, { p_actor: randomUUID() }]) {
    await expect(invokeTeachingCommandWithStatus({ rpc }, 'record_quiz_grade', { ...args, ...change })).rejects.toThrow('VALIDATION_ERROR');
  }
  expect(rpc).not.toHaveBeenCalled();
});

test('customer quiz projections reject roster or another student’s grade and distinguish zero from ungraded', async () => {
  const read = findTeachingOperationReadRoute(`occurrences/${occurrence}/quizzes`);
  expect(read).toBeDefined();
  const options = { view: 'customer', learner_id: learner };
  const response = (row: object) => ({ rpc: vi.fn().mockResolvedValue({ data: { view: 'customer', occurrence_id: occurrence, quizzes: [row] } }) });
  for (const grade of [null, { score: 0, version: 1 }]) {
    await expect(read!.run(response({ ...quiz, grade }), options)).resolves.toMatchObject({ quizzes: [{ grade }] });
  }
  await expect(read!.run(response({ ...quiz, grade: null, grades: [{ learner_id: randomUUID(), score: 8, version: 1 }] }), options)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  const dashboard = findTeachingOperationReadRoute('me/quiz-results');
  expect(dashboard?.fields).toEqual(['learner_id', 'cursor', 'limit']);
  await expect(dashboard!.run({ rpc: vi.fn() }, { limit: 0 })).rejects.toThrow('VALIDATION_ERROR');
});
