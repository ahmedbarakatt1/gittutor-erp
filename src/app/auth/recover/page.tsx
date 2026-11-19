import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';

export const metadata: Metadata = { title: 'Reset your password | Git Tutor', robots: { index: false, follow: false } };

export default function RecoverPage() {
  return <AuthPage mode="recover" />;
}
