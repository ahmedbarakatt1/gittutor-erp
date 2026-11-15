import { RequestEntry } from '@/components/requests/entry';
import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { GuardianWorkspace } from '@/components/identity-workspaces';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
import styles from '@/components/auth.module.css';

export const metadata: Metadata = { title: 'Your learning | Git Tutor', robots: { index: false, follow: false } };
export default async function LearnerPage({ searchParams }: { searchParams: Promise<{ staff_invitation_id?: string }> }) {
  const account = await requireAccount('student');
  const invitationId = (await searchParams).staff_invitation_id;
  const operations = await getWorkflowOperations(await serverSupabase());
  if (operations.enabled) return <PortalShell kind="learn" account={account} title="Your learning overview" description="Your lessons, package history and next steps." showAccount={false} activePath="/learn"><RequestEntry /><OperationalWorkspace view="overview" /><section id="learners" className={styles.section}><h2>Linked learners and account requests</h2><GuardianWorkspace staffInvitationId={typeof invitationId === 'string' ? invitationId : undefined} /></section></PortalShell>;
  return <PortalShell kind="learn" account={account}><RequestEntry /><GuardianWorkspace staffInvitationId={typeof invitationId === 'string' ? invitationId : undefined} /></PortalShell>;
}
