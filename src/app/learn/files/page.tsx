import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerStudyFiles } from '@/components/files/materials';
import { fileCopy as copy } from '@/locales/files';
import { fileCopy as arabicFileCopy } from '@/locales/ar-transaction/files';
import { getSiteLanguage } from '@/server/site-language';


const textByLanguage = {
  en: { copy },
  ar: { copy: arabicFileCopy },
};

export const generateMetadata = pageMetadata({ title: 'Study files | Git Tutor', robots: { index: false, follow: false } });
export default async function StudyFilesPage({ searchParams }: { searchParams: Promise<{ enrollment?: string }> }) {
  const uiLanguage = await getSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const account = await requireAccount('student'); const { enrollment } = await searchParams;
  const id = typeof enrollment === 'string' && /^[0-9a-f-]{36}$/i.test(enrollment) ? enrollment : undefined;
  return <PortalShell kind="learn" account={account} title={copy.title} description={copy.description} activePath="/learn/files" showAccount={false}><CustomerStudyFiles initialEnrollment={id} /></PortalShell>;
}
