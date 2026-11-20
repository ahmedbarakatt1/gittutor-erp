import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerPackages } from '@/components/packages/customer-packages';
import { packageCopy as copy } from '@/locales/packages';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';

export const metadata: Metadata = { title: 'Your packages | Git Tutor', robots: { index: false, follow: false } };
export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ learner?: string; contract?: string }> }) {
  const input = await searchParams; const valid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
  const learner = valid(input.learner); const contract = valid(input.contract); const params = new URLSearchParams(); if (learner) params.set('learner', learner); if (contract) params.set('contract', contract);
  const account = await requireAccount('student', `/learn/packages${params.size ? `?${params}` : ''}`);
  return <PortalShell kind="learn" account={account} title={copy.title} description={copy.description} activePath="/learn/packages" showAccount={false}><WorkflowOperationsWorkspace workspace="learn" view="packages" collapsed={Boolean(learner || contract)}><CustomerPackages initialLearner={learner} initialContract={contract} /></WorkflowOperationsWorkspace></PortalShell>;
}
