import { PortalShell } from '@/components/portal-shell';
import { TutorQuizzes } from '@/components/quizzes/tutor-quizzes';
import { quizCopy as copy } from '@/locales/quizzes';
import { requireAccount } from '@/server/auth';
import { z } from 'zod';

export const metadata = { title: 'Session quizzes | Git Tutor', robots: { index: false, follow: false } };

export default async function QuizzesPage({ searchParams }: { searchParams: Promise<{ occurrence?: string }> }) {
  const account = await requireAccount('tutor');
  const id = z.uuid().safeParse((await searchParams).occurrence);
  return <PortalShell kind="tutor" account={account} activePath="/tutor/quizzes" title={copy.tutorTitle} description={copy.tutorIntro} showAccount={false}>
    <TutorQuizzes initialOccurrence={id.success ? id.data : undefined} />
  </PortalShell>;
}
