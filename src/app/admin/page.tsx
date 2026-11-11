import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { StaffAccessWorkspace, TutorApplicationReview } from '@/components/identity-workspaces';

export const metadata: Metadata = { title: 'Administration | Git Tutor', robots: { index: false, follow: false } };
export default async function AdminPage() { return <PortalShell kind="admin" account={await requireAccount('admin')}><TutorApplicationReview /><StaffAccessWorkspace /></PortalShell>; }
