import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { GuardianWorkspace } from '@/components/identity-workspaces';

export const metadata: Metadata = { title: 'Your learning | Git Tutor', robots: { index: false, follow: false } };
export default async function LearnerPage({ searchParams }: { searchParams: Promise<{ staff_invitation_id?: string }> }) {
  const account = await requireAccount('student');
  const invitationId = (await searchParams).staff_invitation_id;
  return <PortalShell kind="learn" account={account}><GuardianWorkspace staffInvitationId={typeof invitationId === 'string' ? invitationId : undefined} /></PortalShell>;
}
