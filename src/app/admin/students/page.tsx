import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AnalyticsWorkspace } from '@/components/analytics/workspace';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Student progression | Git Tutor', robots: { index: false, follow: false } };
export default async function StudentsPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title="Student progression" description="Follow each learner from first inquiry to approved attendance." activePath="/admin/students" showAccount={false}><WorkflowOperationsWorkspace view="students"><AnalyticsWorkspace view="students" asOf={new Date().toISOString()} /></WorkflowOperationsWorkspace></PortalShell>; }
