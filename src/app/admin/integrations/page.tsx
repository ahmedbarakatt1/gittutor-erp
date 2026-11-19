import { parseServerConfig } from '@/server/config';
import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CalendarConnectionPanel } from '@/components/teaching/calendar-connection';
import { ManualWhatsApp } from '@/components/support/manual-whatsapp';
import { meetingCopy as copy } from '@/locales/meetings';
export const metadata: Metadata = { title: 'Integrations | Git Tutor', robots: { index: false, follow: false } };
export default async function IntegrationsPage() {
  const account = await requireAccount('admin');
  const { calendar, whatsapp } = parseServerConfig(process.env).providers;
  return <PortalShell kind="admin" account={account} title={copy.integrations} description={copy.integrationDescription} activePath="/admin/integrations" showAccount={false}>
    <CalendarConnectionPanel provider={calendar} />
    {whatsapp === 'manual' && <ManualWhatsApp staff />}
  </PortalShell>;
}
