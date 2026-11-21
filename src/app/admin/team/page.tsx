import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AnalyticsWorkspace } from '@/components/analytics/workspace';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const generateMetadata = pageMetadata({ title: 'Team workload | Git Tutor', robots: { index: false, follow: false } });
export default async function TeamPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title="Team workload" description="Reconcile teaching time, current capacity and support ownership." activePath="/admin/team" showAccount={false}><WorkflowOperationsWorkspace workspace="admin" view="team"><AnalyticsWorkspace view="team" asOf={new Date().toISOString()} /></WorkflowOperationsWorkspace></PortalShell>; }
