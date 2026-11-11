import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { TutorProfileWorkspace } from '@/components/identity-workspaces';

export const metadata: Metadata = { title: 'Tutor workspace | Git Tutor', robots: { index: false, follow: false } };
export default async function TutorPage() { return <PortalShell kind="tutor" account={await requireAccount('tutor')}><TutorProfileWorkspace /></PortalShell>; }
