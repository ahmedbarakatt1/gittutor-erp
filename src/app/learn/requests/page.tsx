import type { Metadata } from 'next';
import { z } from 'zod';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RequestWorkspace } from '@/components/requests/workspace';

export const metadata: Metadata = { title: 'Request a session | Git Tutor', robots: { index: false, follow: false } };
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ topic?: string; request?: string }> }) {
  const query = await searchParams, selected = z.uuid().safeParse(query.request);
  const topic = typeof query.topic === 'string' ? query.topic.trim().slice(0, 160) : '';
  const params = new URLSearchParams();
  if (selected.success) params.set('request', selected.data); else if (topic) params.set('topic', topic);
  const account = await requireAccount('student', `/learn/requests${params.size ? `?${params}` : ''}`);
  return <PortalShell kind="learn" account={account} title="Request a tutoring session" description="Your course material is the starting point. Tell us what you need, upload your files, and send your request." showAccount={false} activePath="/learn/requests"><RequestWorkspace key={params.toString()} selectedId={selected.success ? selected.data : undefined} initialTopic={topic} /></PortalShell>;
}
