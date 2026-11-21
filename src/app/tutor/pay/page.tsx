import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { PayrollWorkspace } from '@/components/teaching/payroll-workspace';
import { payrollCopy as copy } from '@/locales/payroll';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';
import { payrollCopy as arabicPayrollCopy } from '@/locales/ar-transaction/payroll';
import { getSiteLanguage } from '@/server/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPayrollCopy },
};

export const generateMetadata = pageMetadata({ title: 'Tutor pay | Git Tutor', robots: { index: false, follow: false } });
export default async function PayPage() {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 const account = await requireAccount('tutor'); return <PortalShell kind="tutor" account={account} title={copy.title} description={copy.intro} activePath="/tutor/pay" showAccount={false}><WorkflowOperationsWorkspace workspace="tutor" view="tutor_pay"><PayrollWorkspace /></WorkflowOperationsWorkspace></PortalShell>; }
