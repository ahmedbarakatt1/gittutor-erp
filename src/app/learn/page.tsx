import { StaffMessage } from '@/components/ar-staff-label';
import { pageMetadata } from '@/server/page-metadata';
import { RequestEntry } from '@/components/requests/entry';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { GuardianWorkspace } from '@/components/identity-workspaces';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
import styles from '@/components/auth.module.css';

export const generateMetadata = pageMetadata({ title: 'Your learning | Git Tutor', robots: { index: false, follow: false } });
export default async function LearnerPage({ searchParams }: { searchParams: Promise<{ staff_invitation_id?: string }> }) {
  const account = await requireAccount('student');
  const invitationId = (await searchParams).staff_invitation_id;
  const operations = await getWorkflowOperations(await serverSupabase(), 'learn');
  if (operations.enabled) return <PortalShell kind="learn" account={account} title="Your learning overview" description="Your lessons, package history and next steps." showAccount={false} activePath="/learn" primaryAction={<RequestEntry />}>
    <OperationalWorkspace workspace="learn" view="overview" />
    <details id="learners" className={styles.accountTools} open={typeof invitationId === 'string' && Boolean(invitationId)}>
      <summary><StaffMessage text="Linked learners and account requests" /></summary>
      <GuardianWorkspace staffInvitationId={typeof invitationId === 'string' ? invitationId : undefined} />
    </details>
  </PortalShell>;
  return <PortalShell kind="learn" account={account} primaryAction={<RequestEntry />}><GuardianWorkspace staffInvitationId={typeof invitationId === 'string' ? invitationId : undefined} /></PortalShell>;
}
