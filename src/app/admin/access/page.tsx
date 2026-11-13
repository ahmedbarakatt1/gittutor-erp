import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { StaffAccessWorkspace, TutorApplicationReview } from '@/components/identity-workspaces';

export const metadata: Metadata = { title: 'Staff and applications | Git Tutor', robots: { index: false, follow: false } };
export default async function AccessPage() {
  return <PortalShell kind="admin" account={await requireAccount('admin')} title="Staff and applications" description="Manage staff access and review tutor applications." activePath="/admin/access" showAccount={false}><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>;
}
