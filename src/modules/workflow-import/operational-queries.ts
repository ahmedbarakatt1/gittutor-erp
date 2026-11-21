import { bookingRpc, BookingRpcError, type BookingRpcClient } from '../booking/commands';
import { workflowOperationsSchema, workflowReviewInputSchema, workflowReviewResultSchema, type WorkbookWorkspace } from './operational-model';

export async function getWorkflowOperations(client: BookingRpcClient, workspace: WorkbookWorkspace) {
  const result = workflowOperationsSchema.safeParse((await bookingRpc(client, 'get_workspace_operations', { p_workspace: workspace })).data);
  if (!result.success) throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');
  const expectedRole = { learn: 'customer', tutor: 'tutor', service: 'service', admin: 'owner' }[workspace];
  if (result.data.enabled && result.data.role !== expectedRole) throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');
  return result.data;
}
export async function reviewWorkflowOperation(client: BookingRpcClient, input: unknown) {
  const parsed = workflowReviewInputSchema.safeParse(input);
  if (!parsed.success) throw new BookingRpcError('VALIDATION_ERROR');
  const args = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [`p_${key}`, value]));
  const result = workflowReviewResultSchema.safeParse((await bookingRpc(client, 'review_workflow_operation', args)).data);
  if (!result.success) throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');
  return result.data;
}
