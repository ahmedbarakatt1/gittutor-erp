import { getFile, listFiles, listMyMaterialEnrollments } from '@/modules/files/queries';
import type { FileCommandName, FileRpcClient } from '@/modules/files/commands';

type FileRoute = { family: 'files'; pattern: RegExp; rpc: FileCommandName; pathArgument?: string; fields: string[] };
export const fileCommandRoutes: FileRoute[] = [
  { family: 'files', pattern: /^files$/, rpc: 'create_file_upload', fields: ['purpose', 'parent_id', 'filename', 'declared_type', 'size_bytes', 'checksum_sha256', 'evidence_action'] },
  { family: 'files', pattern: /^files\/([^/]+)\/complete$/, rpc: 'finalize_file_upload', pathArgument: 'file_id', fields: ['checksum_sha256'] },
  { family: 'files', pattern: /^files\/([^/]+)\/publish$/, rpc: 'publish_shared_file', pathArgument: 'file_id', fields: ['expected_version'] },
  { family: 'files', pattern: /^files\/([^/]+)\/withdraw$/, rpc: 'withdraw_shared_file', pathArgument: 'file_id', fields: ['reason', 'expected_version'] },
];
export function findFileReadRoute(path: string): { fields: string[]; run: (client: FileRpcClient, options: Record<string, unknown>) => Promise<unknown> } | undefined {
  if (path === 'me/material-enrollments') return { fields: ['cursor', 'limit'], run: (client, options) => listMyMaterialEnrollments(client, options) };
  if (path === 'files') return { fields: ['enrollment_id', 'occurrence_id', 'purpose', 'cursor', 'limit'], run: (client, options) => listFiles(client, options as Parameters<typeof listFiles>[1]) };
  const file = /^files\/([^/]+)$/.exec(path); if (file) return { fields: [], run: client => getFile(client, file[1]) };
}
