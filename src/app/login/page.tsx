import { pageMetadata } from '@/server/page-metadata';
import { AuthPage } from '@/components/auth-page';
import { AuthUnavailableError, getCurrentAccount } from '@/server/auth';
import { customerReturnPath } from '@/modules/identity/return-path';
import { redirect } from 'next/navigation';
import { landingForRoles } from '@/server/http';

export const generateMetadata = pageMetadata({ title: 'Sign in | Git Tutor', robots: { index: false, follow: false } });

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; return_to?: string }> }) {
  let unavailable = false;
  const params = await searchParams;
  const returnTo = customerReturnPath(params.return_to);
  try {
    const account = await getCurrentAccount();
    if (account) redirect(params.reason === 'forbidden' ? landingForRoles(account.roles) : returnTo || landingForRoles(account.roles));
  } catch (error) {
    if (!(error instanceof AuthUnavailableError)) throw error;
    unavailable = true;
  }
  return <AuthPage mode="login" unavailable={unavailable} forbidden={params.reason === 'forbidden'} returnTo={returnTo} />;
}
