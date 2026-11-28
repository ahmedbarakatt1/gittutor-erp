import { pageMetadata } from '@/server/page-metadata';
import { sessionLength } from '@/modules/catalog/public-tuition';

import { getSiteLanguage } from '@/server/site-language';
import { PublicShell } from '@/components/catalog/public-shell';
import { TuitionComparison } from '@/components/catalog/tuition-comparison';

export const generateMetadata = pageMetadata({ title: 'Session pricing | Git Tutor', description: `View individual and group tuition per student. Sessions last ${sessionLength}.` });
export default async function PricingPage() {
  const language = await getSiteLanguage();
  return <PublicShell language={language} active="offers"><TuitionComparison language={language} /></PublicShell>;
}
