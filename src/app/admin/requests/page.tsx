import type { Metadata } from 'next';
import { z } from 'zod';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { RequestWorkspace } from '@/components/requests/workspace';
export const metadata: Metadata = { title: 'Session requests | Git Tutor admin', robots: { index: false, follow: false } };
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const account = await requireAccount('admin'), selected = z.uuid().safeParse((await searchParams).request);
  return <PortalShell kind="admin" account={account} title="Session requests" description="Review incoming material, reply to customers and arrange suitable sessions." showAccount={false} activePath="/admin/requests"><RequestWorkspace key={selected.success ? selected.data : 'queue'} view="admin" selectedId={selected.success ? selected.data : undefined} /></PortalShell>;
}
