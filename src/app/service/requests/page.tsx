import { pageMetadata } from '@/server/page-metadata';
import { getSiteLanguage } from '@/server/site-language';
import { requestTranslator } from '@/locales/ar-public-requests';
import { z } from 'zod';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RequestWorkspace } from '@/components/requests/workspace';
export const generateMetadata = pageMetadata({ title: 'Session requests | Git Tutor service', robots: { index: false, follow: false } });
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const account = await requireAccount('customer_service'), selected = z.uuid().safeParse((await searchParams).request);
  const text = requestTranslator(await getSiteLanguage());
  return <PortalShell kind="service" account={account} title={text('Session requests')} description={text('Review student material, follow up with families and propose suitable sessions.')} showAccount={false} activePath="/service/requests"><RequestWorkspace key={selected.success ? selected.data : 'queue'} view="service" selectedId={selected.success ? selected.data : undefined} /></PortalShell>;
}
