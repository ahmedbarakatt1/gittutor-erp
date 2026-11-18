import { parseServerConfig } from '@/server/config';
import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CalendarConnectionPanel } from '@/components/teaching/calendar-connection';
import { meetingCopy as copy } from '@/locales/meetings';
export const metadata: Metadata = { title: 'Integrations | Git Tutor', robots: { index: false, follow: false } };
export default async function IntegrationsPage() { const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.integrations} description={copy.integrationDescription} activePath="/admin/integrations" showAccount={false}><CalendarConnectionPanel provider={parseServerConfig(process.env).providers.calendar} /></PortalShell>; }
