import { pageMetadata } from '@/server/page-metadata';
import { getSiteLanguage } from '@/server/site-language';
import { requestTranslator } from '@/locales/ar-public-requests';
import { z } from 'zod';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RequestWorkspace } from '@/components/requests/workspace';

export const generateMetadata = pageMetadata({ title: 'Request a session | Git Tutor', robots: { index: false, follow: false } });
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ topic?: string; request?: string }> }) {
  const query = await searchParams, selected = z.uuid().safeParse(query.request);
  const topic = typeof query.topic === 'string' ? query.topic.trim().slice(0, 160) : '';
  const params = new URLSearchParams();
  if (selected.success) params.set('request', selected.data); else if (topic) params.set('topic', topic);
  const account = await requireAccount('student', `/learn/requests${params.size ? `?${params}` : ''}`);
  const text = requestTranslator(await getSiteLanguage());
  return <PortalShell kind="learn" account={account} title={text('Request a tutoring session')} description={text('Your course material is the starting point. Tell us what you need, upload your files, and send your request.')} showAccount={false} activePath="/learn/requests"><RequestWorkspace driveEnabled={process.env.REQUEST_DRIVE_ADAPTER === 'google'} key={params.toString()} selectedId={selected.success ? selected.data : undefined} initialTopic={topic} /></PortalShell>;
}
