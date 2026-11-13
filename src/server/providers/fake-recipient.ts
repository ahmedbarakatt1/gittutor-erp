import { z } from 'zod';

const email = z.email().max(254);
const reservedDomains = new Set(['example.test', 'preview.gittutor.invalid']);

/** Fake adapters may persist mail only for these exact reserved domains. */
export function isSafeFakeRecipient(value: unknown): value is string {
  const parsed = email.safeParse(value);
  return parsed.success && reservedDomains.has(parsed.data.slice(parsed.data.lastIndexOf('@') + 1).toLowerCase());
}

export function assertFakeProviderIsolation(errorCode: string, isolated = true): void {
  if (!isolated || !['development', 'test'].includes(process.env.APP_ENV ?? 'development')) throw new Error(errorCode);
}
