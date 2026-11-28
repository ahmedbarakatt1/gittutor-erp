import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { TeachingOperations } from '@/components/teaching/operations-workspace';
import { operationsCopy as copy } from '@/locales/teaching-operations';
export const generateMetadata = pageMetadata({ title: 'Teaching operations | Git Tutor', robots: { index: false, follow: false } });
export default async function TeachingPage({ searchParams }: { searchParams: Promise<{ change_set?: string }> }) { const account = await requireAccount('admin'); const { change_set } = await searchParams; const id = typeof change_set === 'string' && /^[0-9a-f-]{36}$/i.test(change_set) ? change_set : undefined; return <PortalShell kind="admin" account={account} title={copy.title} description={copy.intro} activePath="/admin/teaching" showAccount={false}><TeachingOperations view="admin" initialChangeSet={id} /></PortalShell>; }
