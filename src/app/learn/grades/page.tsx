import { PortalShell } from '@/components/portal-shell';
import { StudentGrades } from '@/components/quizzes/student-grades';
import { quizCopy as copy } from '@/locales/quizzes';
import { requireAccount } from '@/server/auth';

export const metadata = { title: 'Quizzes and grades | Git Tutor', robots: { index: false, follow: false } };

export default async function GradesPage() {
  const account = await requireAccount('student', '/learn/grades');
  return <PortalShell kind="learn" account={account} activePath="/learn/grades" title={copy.studentTitle} description={copy.studentIntro} showAccount={false}>
    <StudentGrades />
  </PortalShell>;
}
