import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { TutorProfileWorkspace } from '@/components/identity-workspaces';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
import styles from '@/components/auth.module.css';

export const metadata: Metadata = { title: 'Tutor workspace | Git Tutor', robots: { index: false, follow: false } };
export default async function TutorPage() {
  const account = await requireAccount('tutor'), operations = await getWorkflowOperations(await serverSupabase());
  if (operations.enabled) return <PortalShell kind="tutor" account={account} title="Your teaching overview" description="Your lessons and reported earnings in one place." showAccount={false} activePath="/tutor">
    <OperationalWorkspace view="overview" />
    <details className={styles.accountTools}>
      <summary>Edit teaching profile</summary>
      <TutorProfileWorkspace />
    </details>
  </PortalShell>;
  return <PortalShell kind="tutor" account={account}><TutorProfileWorkspace /></PortalShell>;
}
