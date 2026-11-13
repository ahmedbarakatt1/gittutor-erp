import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AnalyticsWorkspace } from '@/components/analytics/workspace';
import { cairoDate } from '@/modules/shared/primitives';
export const metadata: Metadata = { title: 'Student progression | Git Tutor', robots: { index: false, follow: false } };
export default async function StudentsPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title="Student progression" description="Follow each verified learner from first inquiry to approved attendance." activePath="/admin/students" showAccount={false}><AnalyticsWorkspace view="students" today={cairoDate(new Date())} /></PortalShell>; }
