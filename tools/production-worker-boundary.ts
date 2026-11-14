import type { Client } from 'pg';

// Reviewed exact RPC boundary from the application migrations, including server-mediated calls.
// A new migration granting the worker another signature must update this list explicitly.
const queueSignatures = ['claim_jobs(text,integer,integer)', 'complete_job(uuid,uuid,text)', 'fail_job(uuid,uuid,text,boolean)'];
const commandSignatures = [
  'finalize_calendar_sync(uuid,integer,uuid,integer,integer,uuid,uuid,jsonb)',
  'finalize_export_render(uuid,uuid,uuid,integer,text)', 'finalize_file_scan(uuid,integer,uuid,uuid,jsonb)',
  'finalize_notification_delivery(uuid,uuid,uuid,uuid,jsonb)', 'finalize_statement_import(uuid,integer,text,text,jsonb,text,text)',
  'finalize_whatsapp_send(uuid,uuid,uuid,jsonb)', 'get_calendar_credentials(uuid,integer,uuid,uuid)',
  'get_staff_invitation_delivery(uuid)',
  'issue_destination_validation_artifact(uuid,uuid,uuid,integer,text,text,text,text,jsonb)',
  'issue_payout_destination_validation_artifact(uuid,uuid,uuid,integer,text,text,text,text,jsonb)',
  'prepare_calendar_sync(uuid,uuid,uuid)', 'prepare_export_download(uuid,uuid,text)', 'prepare_export_render(uuid,uuid,uuid)',
  'prepare_file_content(uuid,uuid)', 'prepare_file_download(uuid,uuid)', 'prepare_file_scan(uuid,uuid,uuid)',
  'prepare_notification_delivery(uuid,uuid,uuid)', 'prepare_payout_destination(uuid,uuid,text)',
  'prepare_refund_destination_context(uuid,uuid,uuid,text)', 'prepare_statement_import(uuid,text)',
  'prepare_whatsapp_send(uuid,uuid,uuid,text,text)', 'process_occurrence_booking_due(uuid,text)', 'process_package_due(uuid,text)',
  'read_payout_destination_for_server(uuid,uuid,uuid,text,uuid,text)', 'read_refund_destination_for_server(uuid,uuid,uuid,text,uuid,text)',
  'record_calendar_connection(uuid,uuid,uuid,text,text,jsonb,text)',
  'record_email_callback(uuid,text,uuid,text,timestamp with time zone)', 'record_file_object(uuid,uuid,uuid,jsonb)',
  'record_staff_invitation_delivery(uuid,integer,text,uuid,text)', 'record_whatsapp_event(text,text,jsonb)',
  'rotate_calendar_credentials(uuid,integer,uuid,uuid,jsonb,text,uuid,uuid)', 'route_notification_event(uuid,uuid)',
];
export const workerRpcOwners: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries([
  ...queueSignatures.map(signature => [`app_private.${signature}`, 'git_tutor_worker_api']),
  ...commandSignatures.map(signature => [`app_private.${signature}`, 'git_tutor_commands']),
]));
export type WorkerFunctionBoundary = { signature: string; owner: string; definer: boolean; owner_login: boolean; owner_bypassrls: boolean; fixed_search_path: boolean };

export async function readWorkerFunctionBoundary(database: Pick<Client, 'query'>): Promise<WorkerFunctionBoundary[]> {
  // has_function_privilege includes PUBLIC and inherited grants, not just direct ACL entries.
  return (await database.query(`select p.oid::regprocedure::text signature,r.rolname owner,p.prosecdef definer,
    r.rolcanlogin owner_login,r.rolbypassrls owner_bypassrls,coalesce('search_path=""'=any(p.proconfig),false) fixed_search_path
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
    where n.nspname in('app_private','api','finance_private') and has_function_privilege('git_tutor_worker',p.oid,'EXECUTE')`)).rows;
}

export function workerFunctionsAreRestricted(functions: WorkerFunctionBoundary[]): boolean {
  return functions.length === Object.keys(workerRpcOwners).length
    && new Set(functions.map(fn => fn.signature)).size === functions.length
    && functions.every(fn => workerRpcOwners[fn.signature] === fn.owner && fn.definer && !fn.owner_login && !fn.owner_bypassrls && fn.fixed_search_path);
}
