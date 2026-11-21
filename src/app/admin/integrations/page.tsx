import { pageMetadata } from '@/server/page-metadata';
import { parseServerConfig } from '@/server/config';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CalendarConnectionPanel } from '@/components/teaching/calendar-connection';
import { ManualWhatsApp } from '@/components/support/manual-whatsapp';
import { meetingCopy as copy } from '@/locales/meetings';
import { meetingCopy as arabicMeetingCopy } from '@/locales/ar-transaction/meetings';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicMeetingCopy },
};

export const generateMetadata = pageMetadata({ title: 'Integrations | Git Tutor', robots: { index: false, follow: false } });
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const account = await requireAccount('admin');
  const settings = parseServerConfig(process.env);
  const { calendar, whatsapp } = settings.providers;
  return <PortalShell kind="admin" account={account} title={copy.integrations} description={copy.integrationDescription} activePath="/admin/integrations" showAccount={false}>
    <CalendarConnectionPanel provider={calendar} verifyGoogleRooms={settings.environment === 'production' && calendar === 'google'} outcome={(await searchParams).calendar} />
    {whatsapp === 'manual' && <ManualWhatsApp staff />}
  </PortalShell>;
}
