import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { TeachingOperations } from '@/components/teaching/operations-workspace';
import { operationsCopy as copy } from '@/locales/teaching-operations';
export const metadata: Metadata = { title: 'Teaching operations | Git Tutor', robots: { index: false, follow: false } };
export default async function TeachingPage() { const account = await requireAccount('tutor'); return <PortalShell kind="tutor" account={account} title={copy.title} description={copy.intro} activePath="/tutor/teaching" showAccount={false}><TeachingOperations view="tutor" /></PortalShell>; }
