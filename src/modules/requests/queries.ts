import { z } from 'zod';
import { fileViewSchema } from '../files/queries';
import { requestFormatSchema, requestStateSchema, requestRpc, RequestError, type RequestRpcClient } from './commands';

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const cursor = z.string().min(1).max(200);
const pages = z.object({ cursor: cursor.nullable().optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const matchSchema = z.object({
  offer_id: id, occurrence_id: id, title: z.string(), start_at: instant, end_at: instant,
  available_seats: z.number().int().min(0).max(4), customer_price_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const tutoringRequestViewSchema = z.object({
  request_id: id,
  learner: z.object({ learner_id: id, display_name: z.string() }).strict(),
  topic: z.string().min(1).max(160),
  course: z.string().max(160),
  description: z.string().min(1).max(4000),
  preferred_times: z.string().min(1).max(1000),
  format: requestFormatSchema,
  state: requestStateSchema,
  version: z.number().int().positive().max(2147483647),
  customer_reply: z.string().max(2000).nullable(),
  matched_session: matchSchema.extend({ enrollment_id: id.nullable() }).nullable(),
  files: z.array(fileViewSchema),
  created_at: instant,
  updated_at: instant,
  can_edit: z.boolean(),
  can_review: z.boolean(),
}).strict();

export type TutoringRequestView = z.infer<typeof tutoringRequestViewSchema>;
export type RequestFormat = z.infer<typeof requestFormatSchema>;
export type RequestState = z.infer<typeof requestStateSchema>;
export type RequestMatch = z.infer<typeof matchSchema>;
const pageSchema = z.object({ items: z.array(tutoringRequestViewSchema), next_cursor: cursor.nullable() }).strict();
const matchesSchema = z.object({ items: z.array(matchSchema), next_cursor: cursor.nullable() }).strict();

async function read<S extends z.ZodType>(client: RequestRpcClient, name: string, args: Record<string, unknown>, schema: S): Promise<z.output<S>> {
  const result = schema.safeParse((await requestRpc(client, name, args)).data);
  if (!result.success) throw new RequestError('DEPENDENCY_UNAVAILABLE');
  return result.data;
}

function pageOptions(options: z.input<typeof pages>) {
  const parsed = pages.safeParse(options);
  if (!parsed.success) throw new RequestError('VALIDATION_ERROR');
  return { p_cursor: parsed.data.cursor ?? null, p_limit: parsed.data.limit ?? 25 };
}

export function listRequests(client: RequestRpcClient, options: z.input<typeof pages> = {}) {
  return read(client, 'list_tutoring_requests', pageOptions(options), pageSchema);
}

export function listRequestQueue(client: RequestRpcClient, options: z.input<typeof pages> = {}) {
  return read(client, 'list_tutoring_request_queue', pageOptions(options), pageSchema);
}

export function listRequestMatches(client: RequestRpcClient, requestId: string, options: z.input<typeof pages> = {}) {
  if (!id.safeParse(requestId).success) throw new RequestError('NOT_FOUND');
  return read(client, 'list_tutoring_request_matches', { ...pageOptions(options), p_request_id: requestId }, matchesSchema);
}

export function getTutoringRequest(client: RequestRpcClient, requestId: string) {
  if (!id.safeParse(requestId).success) throw new RequestError('NOT_FOUND');
  return read(client, 'get_tutoring_request', { p_request_id: requestId }, tutoringRequestViewSchema);
}
