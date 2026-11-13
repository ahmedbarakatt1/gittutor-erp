import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AnalyticsWorkspace } from '@/components/analytics/workspace';
import { cairoDate } from '@/modules/shared/primitives';
export const metadata: Metadata = { title: 'Campaigns | Git Tutor', robots: { index: false, follow: false } };
export default async function CampaignsPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title="Campaigns" description="Review source evidence, dated spend and first-attendance acquisition." activePath="/admin/campaigns" showAccount={false}><AnalyticsWorkspace view="campaigns" today={cairoDate(new Date())} /></PortalShell>; }
