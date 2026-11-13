import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AnalyticsWorkspace } from '@/components/analytics/workspace';
import { cairoDate } from '@/modules/shared/primitives';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Team workload | Git Tutor', robots: { index: false, follow: false } };
export default async function TeamPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title="Team workload" description="Reconcile teaching time, current capacity and support ownership." activePath="/admin/team" showAccount={false}><WorkflowOperationsWorkspace view="team"><AnalyticsWorkspace view="team" today={cairoDate(new Date())} /></WorkflowOperationsWorkspace></PortalShell>; }
