import { z } from 'zod';
import { workflowTables } from './model';

export const workbookWorkspaceSchema = z.enum(['learn', 'tutor', 'service', 'admin']);
export type WorkbookWorkspace = z.infer<typeof workbookWorkspaceSchema>;
const id = z.uuid();
const scalar = z.union([z.string().max(20000), z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.boolean(), z.null()]);
export const workflowSectionKeys = ['sessions', 'customers', 'packages', 'payments', 'finance', 'tutor_pay', 'students', 'team', 'campaigns', 'overview'] as const;
const links = z.object({ learner_id: id.nullable(), tutor_id: id.nullable(), occurrence_id: id.nullable(), package_id: id.nullable() }).strict();
export const workflowOperationRecordSchema = z.object({
  id, title: z.string(), subtitle: z.string(), source_table: z.enum(workflowTables), source_row: z.number().int().positive(),
  reported_status: z.string().nullable(), date: z.string().nullable(),
  fields: z.array(z.object({ key: z.string(), label: z.string(), value: scalar, type: z.enum(['text', 'money', 'number', 'date']) }).strict()),
  issues: z.array(z.string()), actions: z.array(z.object({ label: z.string(), href: z.string().regex(/^\/(?:admin|service|tutor|learn)(?:\/[a-z0-9-]+)*(?:\?[a-z_]+=[a-f0-9-]{36})?(?:#new-activity)?$/) }).strict()),
  review: z.object({ version: z.number().int().positive(), state: z.enum(['needs_review', 'linked', 'reviewed']), can_review: z.boolean() }).strict(), links,
}).strict();
export const workflowOperationSectionSchema = z.object({
  key: z.enum(workflowSectionKeys), title: z.string(), description: z.string(),
  metrics: z.array(z.object({ key: z.string(), label: z.string(), value: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(), unit: z.enum(['money', 'count', 'hours']), basis: z.literal('legacy_reported') }).strict()),
  records: z.array(workflowOperationRecordSchema),
}).strict();
const choice = z.object({ id, display_name: z.string() }).strict();
const safeFields = new Set(['student', 'course', 'topic', 'tutor', 'start_time', 'end_time', 'billing', 'package_reference', 'tuition_minor', 'deposit_paid_minor', 'balance_paid_minor', 'refunded_minor', 'collected_minor', 'student_balance_minor', 'package_price_minor', 'sessions_purchased', 'carried_in_sessions', 'total_sessions', 'sessions_completed', 'sessions_scheduled', 'sessions_remaining', 'not_scheduled', 'renewal_reference', 'current_courses', 'previous_courses', 'faculty', 'university', 'contact', 'parent_contact']);
const tutorFields = new Set(['student', 'course', 'topic', 'tutor', 'start_time', 'end_time', 'tutor_fee_due_minor', 'tutor_fee_paid_minor', 'tutor_fee_balance_minor']);
const safeMetrics = new Set(['source_records', 'source_sessions', 'source_packages', 'source_students', 'source_tutors', 'scheduled_sessions', 'completed_sessions', 'canceled_sessions', 'review_needed']);
export const workflowOperationsSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), role: z.enum(['owner', 'service', 'tutor', 'customer']), mapping_options: z.object({ learners: z.array(choice), tutors: z.array(choice) }).strict(), sections: z.array(workflowOperationSectionSchema) }).strict(),
]).superRefine((value, context) => {
  if (!value.enabled || value.role === 'owner') return;
  if (value.mapping_options.learners.length || value.mapping_options.tutors.length) context.addIssue({ code: 'custom', message: 'Mapping choices require batch ownership' });
  const allowedSections = value.role === 'tutor' ? ['sessions', 'tutor_pay', 'overview'] : ['sessions', 'customers', 'students', 'packages', 'payments', 'overview'];
  for (const section of value.sections) {
    if (!allowedSections.includes(section.key)) context.addIssue({ code: 'custom', message: 'Section outside actor scope' });
    if (section.metrics.some(metric => !safeMetrics.has(metric.key) || metric.unit !== 'count' || metric.value === null || !Number.isSafeInteger(metric.value) || metric.value < 0)) context.addIssue({ code: 'custom', message: 'Metric outside actor allowlist' });
    for (const row of section.records) {
      if (row.review.can_review) context.addIssue({ code: 'custom', message: 'Review requires batch ownership' });
      if (row.fields.some(field => !(value.role === 'tutor' ? tutorFields : safeFields).has(field.key))) context.addIssue({ code: 'custom', message: 'Field outside actor allowlist' });
      if (value.role === 'customer' && row.fields.some(field => ['contact', 'parent_contact'].includes(field.key))) context.addIssue({ code: 'custom', message: 'Raw source contacts require staff scope' });
    }
  }
});
export type WorkflowOperationsData = z.infer<typeof workflowOperationsSchema>;
export type WorkflowOperationsSection = z.infer<typeof workflowOperationSectionSchema>;
export type WorkflowOperationsRecord = z.infer<typeof workflowOperationRecordSchema>;

export const workflowReviewInputSchema = z.object({
  link_id: id, expected_version: z.number().int().positive(), review_state: z.enum(['linked', 'reviewed']), links: links.partial(),
  reason: z.string().trim().min(1).max(2000), idempotency_key: z.string().min(1).max(200),
}).strict();
export const workflowReviewResultSchema = z.object({ link_id: id, version: z.number().int().positive(), review_state: z.enum(['linked', 'reviewed']) }).strict();
