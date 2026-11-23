import { createHash } from 'node:crypto';

// A comparison value for a rendered page. No endpoint accepts this as authentication.
export function sessionView(sessionId: unknown) {
  return typeof sessionId === 'string' && sessionId.length > 0
    ? createHash('sha256').update(sessionId).digest('hex')
    : 'signed-out';
}
