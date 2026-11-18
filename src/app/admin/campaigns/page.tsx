import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AnalyticsWorkspace } from '@/components/analytics/workspace';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
export const metadata: Metadata = { title: 'Campaigns | Git Tutor', robots: { index: false, follow: false } };
export default async function CampaignsPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title="Campaigns" description="Review source evidence, dated spend and first-attendance acquisition." activePath="/admin/campaigns" showAccount={false}><WorkflowOperationsWorkspace view="campaigns"><AnalyticsWorkspace view="campaigns" asOf={new Date().toISOString()} /></WorkflowOperationsWorkspace></PortalShell>; }
