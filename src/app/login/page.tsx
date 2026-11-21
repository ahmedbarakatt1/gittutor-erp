import { pageMetadata } from '@/server/page-metadata';
import { AuthPage } from '@/components/auth-page';
import { AuthUnavailableError, getCurrentAccount } from '@/server/auth';
import { customerReturnPath } from '@/modules/identity/return-path';

export const generateMetadata = pageMetadata({ title: 'Sign in | Git Tutor', robots: { index: false, follow: false } });

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; return_to?: string }> }) {
  let unavailable = false;
  try { await getCurrentAccount(); } catch (error) {
    if (!(error instanceof AuthUnavailableError)) throw error;
    unavailable = true;
  }
  const params = await searchParams;
  return <AuthPage mode="login" unavailable={unavailable} forbidden={params.reason === 'forbidden'} returnTo={customerReturnPath(params.return_to)} />;
}
