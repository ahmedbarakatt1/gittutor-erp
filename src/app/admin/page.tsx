import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { StaffAccessWorkspace, TutorApplicationReview } from '@/components/identity-workspaces';
import { redirect } from 'next/navigation';
import { serverSupabase } from '@/server/supabase';
import { getWorkflowImport } from '@/modules/workflow-import/queries';

export const metadata: Metadata = { title: 'Administration | Git Tutor', robots: { index: false, follow: false } };
export default async function AdminPage() {
  const account = await requireAccount('admin');
  if (await getWorkflowImport(await serverSupabase())) redirect('/admin/workflow');
  return <PortalShell kind="admin" account={account}><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>;
}
