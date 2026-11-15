import type { Metadata } from 'next';
import { z } from 'zod';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RequestWorkspace } from '@/components/requests/workspace';
export const metadata: Metadata = { title: 'Session requests | Git Tutor service', robots: { index: false, follow: false } };
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const account = await requireAccount('customer_service'), selected = z.uuid().safeParse((await searchParams).request);
  return <PortalShell kind="service" account={account} title="Session requests" description="Review student material, follow up with families and propose suitable sessions." showAccount={false} activePath="/service/requests"><RequestWorkspace key={selected.success ? selected.data : 'queue'} view="service" selectedId={selected.success ? selected.data : undefined} /></PortalShell>;
}
