import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { AuthUnavailableError, getCurrentAccount } from '@/server/auth';

export const metadata: Metadata = { title: 'Sign in | Git Tutor', robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  let unavailable = false;
  try { await getCurrentAccount(); } catch (error) {
    if (!(error instanceof AuthUnavailableError)) throw error;
    unavailable = true;
  }
  return <AuthPage mode="login" unavailable={unavailable} forbidden={(await searchParams).reason === 'forbidden'} />;
}
