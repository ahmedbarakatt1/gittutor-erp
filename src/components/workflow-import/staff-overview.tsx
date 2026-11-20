import 'server-only';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { WorkflowOperationsData } from '@/modules/workflow-import/operational-model';
import { listRequestQueue } from '@/modules/requests/queries';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
import { OperationalWorkspace } from './operational-workspaces';
import styles from './operational-workspaces.module.css';

export async function loadStaffOverview(portal: 'admin' | 'service') {
  const client = await serverSupabase();
  const [operations, queue] = await Promise.all([
    getWorkflowOperations(client),
    listRequestQueue(client, { limit: 1 }).catch(() => null),
  ]);
  const firstRequest = queue?.items[0];
  const hint = firstRequest ? `First in queue · ${firstRequest.topic}`
    : queue ? 'No requests in the queue' : 'Queue preview unavailable';
  const queueAction = <Link className={styles.queueAction} href={`/${portal}/requests`} aria-label="Open request queue" aria-describedby="queue-preview">
    <span>Open request queue</span><small id="queue-preview">{hint}</small>
  </Link>;
  return { queueAction, overview: renderDashboardOverview(operations, queueAction) };
}

export function renderDashboardOverview(operations: WorkflowOperationsData, action: ReactNode) {
  if (!operations.enabled) return null;
  const section = operations.sections.find(item => item.key === 'overview');
  const initialData = {
    enabled: operations.enabled, role: operations.role, sections: section ? [section] : [],
    mapping_options: section?.records.some(row => row.review.can_review) ? operations.mapping_options : { learners: [], tutors: [] },
  } satisfies typeof operations;
  return <OperationalWorkspace view="overview" initialData={initialData} overviewAction={action} />;
}
