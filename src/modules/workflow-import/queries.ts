import { z } from 'zod';
import type { IdentityRpcClient } from '@/modules/identity/commands';
import { workflowSnapshotSchema } from './model';

export const workflowImportSchema = z.object({ id: z.uuid(), imported_at: z.string(), snapshot: workflowSnapshotSchema }).strict();
export type WorkflowImport = z.infer<typeof workflowImportSchema>;

/** Database checks both current admin membership and explicit snapshot ownership. */
export async function getWorkflowImport(client: IdentityRpcClient): Promise<WorkflowImport | null> {
  const result = await client.rpc('get_workflow_import');
  if (result.error) throw result.error;
  return result.data === null ? null : workflowImportSchema.parse(result.data);
}
