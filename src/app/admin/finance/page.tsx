import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { FinanceWorkspace } from '@/components/teaching/finance-workspace';
import { financeCopy as copy } from '@/locales/finance';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
import { financeCopy as arabicFinanceCopy } from '@/locales/ar-transaction/finance';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicFinanceCopy },
};

export const generateMetadata = pageMetadata({ title: 'Finance | Git Tutor', robots: { index: false, follow: false } });
export default async function FinancePage() {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const account = await requireAccount('admin'); return <PortalShell kind="admin" account={account} title={copy.title} description={copy.intro} activePath="/admin/finance" showAccount={false}><WorkflowOperationsWorkspace workspace="admin" view="finance"><FinanceWorkspace /></WorkflowOperationsWorkspace></PortalShell>; }
