import { z } from 'zod';
import { fileRpc, FileRpcError, type FileRpcClient } from '../files/commands';

const id = z.uuid();
const version = z.int().min(1).max(2147483647);
const key = z.string().trim().min(1).max(200);
const title = z.string().trim().min(1).max(160);
const score = z.number().min(0).max(10000).refine(value => Number(value.toFixed(2)) === value);
const maximum = score.refine(value => value > 0);
const command = z.strictObject({ command_id: id, resource_id: id, version });
const grade = z.strictObject({ score, version });
const quiz = z.strictObject({
  quiz_id: id, title, max_score: maximum, file_id: id, filename: z.string().min(1).max(255),
  content_path: z.string().regex(/^\/api\/v1\/files\/[a-f0-9-]{36}\/content$/).nullable(),
});
const customerQuiz = quiz.extend({ grade: grade.nullable() });
const tutorQuiz = quiz.extend({ grades: z.array(grade.extend({ learner_id: id })) });
const customerSession = z.strictObject({ view: z.literal('customer'), occurrence_id: id, quizzes: z.array(customerQuiz) });
const tutorSession = z.strictObject({
  view: z.literal('tutor'), occurrence_id: id, quizzes: z.array(tutorQuiz),
  roster: z.array(z.strictObject({ learner_id: id, display_name: z.string() })),
});
const result = customerQuiz.extend({
  learner_id: id, learner_name: z.string(), occurrence_id: id, session_title: z.string(), start_at: z.iso.datetime({ offset: true }),
});
const resultsPage = z.strictObject({ items: z.array(result), next_cursor: z.string().nullable() });
export type SessionQuizzes = z.infer<typeof customerSession> | z.infer<typeof tutorSession>;
export type CustomerQuizResult = z.infer<typeof result>;

export const quizCommands = {
  create_session_quiz: {
    input: z.strictObject({ p_occurrence_id: id, p_file_id: id, p_title: title, p_max_score: maximum, p_idempotency_key: key }),
    output: command.extend({ quiz_id: id }),
  },
  record_quiz_grade: {
    input: z.strictObject({ p_quiz_id: id, p_learner_id: id, p_score: score, p_expected_version: z.int().min(0).max(2147483647), p_idempotency_key: key }),
    output: command.extend({ quiz_id: id, learner_id: id, score }),
  },
};

function parse<S extends z.ZodType>(schema: S, data: unknown, error: string): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new FileRpcError(error);
  return parsed.data;
}

const sessionOptions = z.discriminatedUnion('view', [
  z.strictObject({ view: z.literal('customer'), learner_id: id }), z.strictObject({ view: z.literal('tutor') }),
]);
export async function getSessionQuizzes(client: FileRpcClient, occurrenceId: string, options: unknown): Promise<SessionQuizzes> {
  const filters = parse(sessionOptions, options, 'VALIDATION_ERROR');
  const data = (await fileRpc(client, 'get_session_quizzes', {
    p_occurrence_id: parse(id, occurrenceId, 'VALIDATION_ERROR'), p_view: filters.view,
    p_learner_id: filters.view === 'customer' ? filters.learner_id : null,
  })).data;
  return filters.view === 'customer' ? parse(customerSession, data, 'DEPENDENCY_UNAVAILABLE') : parse(tutorSession, data, 'DEPENDENCY_UNAVAILABLE');
}

const dashboardOptions = z.strictObject({
  learner_id: id.optional(), limit: z.int().min(1).max(100).default(25), cursor: z.string().min(1).max(200).optional(),
});
export async function listMyQuizResults(client: FileRpcClient, options: unknown = {}) {
  const filters = parse(dashboardOptions, options, 'VALIDATION_ERROR');
  const data = (await fileRpc(client, 'list_my_quiz_results', {
    p_learner_id: filters.learner_id ?? null, p_limit: filters.limit, p_cursor: filters.cursor ?? null,
  })).data;
  return parse(resultsPage, data, 'DEPENDENCY_UNAVAILABLE');
}
