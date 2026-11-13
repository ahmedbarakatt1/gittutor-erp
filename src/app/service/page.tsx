import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { OperationalWorkspace } from '@/components/workflow-import/operational-workspaces';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Customer service | Git Tutor', robots: { index: false, follow: false } };
export default async function ServicePage() {
  const account = await requireAccount('customer_service'), operations = await getWorkflowOperations(await serverSupabase());
  if (operations.enabled) return <PortalShell kind="service" account={account} title="Your customer overview" description="Review your customers, reported history and next actions." showAccount={false} activePath="/service"><OperationalWorkspace view="overview" /></PortalShell>;
  return <PortalShell kind="service" account={account} />;
}
