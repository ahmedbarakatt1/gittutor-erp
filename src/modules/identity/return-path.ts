import { z } from 'zod';

/** A booking selection may survive sign-in; this is intentionally not a general redirect URL. */
export function bookingReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500 || /\s/.test(value) || !/^\/learn\/bookings(?:\?[^?#]*)?$/.test(value)) return undefined;
  const params = new URLSearchParams(value.split('?')[1] || '');
  if (new Set(params.keys()).size !== params.size || [...params.keys()].some(key => !['offer', 'occurrence'].includes(key))) return undefined;
  const result = new URLSearchParams();
  for (const key of ['offer', 'occurrence']) {
    if (!params.has(key)) continue;
    const parsed = z.uuid().safeParse(params.get(key));
    if (!parsed.success) return undefined;
    result.set(key, parsed.data);
  }
  if (result.has('occurrence') && !result.has('offer')) return undefined;
  return `/learn/bookings${result.size ? `?${result}` : ''}`;
}
