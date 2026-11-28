import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AdminPackages } from '@/components/packages/admin-packages';
import { packageCopy as copy } from '@/locales/packages';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
import { packageCopy as arabicPackageCopy } from '@/locales/ar-transaction/packages';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPackageCopy },
};


export const generateMetadata = pageMetadata({ title: 'Package operations | Git Tutor', robots: { index: false, follow: false } });
export default async function AdminPackagesPage({ searchParams }: { searchParams: Promise<{ package?: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const account = await requireAccount('admin'); const input = await searchParams; const id = typeof input.package === 'string' && /^[0-9a-f-]{36}$/i.test(input.package) ? input.package : undefined;
  return <PortalShell kind="admin" account={account} title={copy.adminTitle} description={copy.adminDescription} activePath="/admin/packages" showAccount={false}><WorkflowOperationsWorkspace workspace="admin" view="packages" collapsed={Boolean(id)}><AdminPackages initialPackage={id} /></WorkflowOperationsWorkspace></PortalShell>;
}
