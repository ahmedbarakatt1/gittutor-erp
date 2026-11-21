import { pageMetadata } from '@/server/page-metadata';
import { AuthPage } from '@/components/auth-page';

export const generateMetadata = pageMetadata({ title: 'Reset your password | Git Tutor', robots: { index: false, follow: false } });

export default function RecoverPage() {
  return <AuthPage mode="recover" />;
}
