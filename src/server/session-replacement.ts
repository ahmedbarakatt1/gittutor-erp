import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from './http';

type Auth = Pick<SupabaseClient['auth'], 'admin' | 'getSession' | 'signOut'>;

export async function priorSessionToken(auth: Auth) {
  // Only pass this opaque credential back to its issuer. Never use its payload
  // for authorization or include it in a response, log or comparison header.
  const { data, error } = await auth.getSession();
  if (error && error.status !== 400 && error.status !== 401 && error.name !== 'AuthSessionMissingError') {
    throw new DomainError('DEPENDENCY_UNAVAILABLE');
  }
  return data.session?.access_token;
}

export async function retireReplacedSession(auth: Auth, previous: string | undefined, next: string | undefined) {
  if (!previous || !next || previous === next) return;
  const { error } = await auth.admin.signOut(previous, 'local');
  // Auth-js can normalize an already revoked session to AuthSessionMissingError
  // without preserving the provider code. Both responses confirm retirement.
  if (error && error.name !== 'AuthSessionMissingError' && error.code !== 'session_not_found' && error.code !== 'user_not_found') {
    await auth.signOut({ scope: 'local' });
    throw new DomainError('DEPENDENCY_UNAVAILABLE');
  }
}
