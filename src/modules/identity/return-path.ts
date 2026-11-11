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

/** Preserve a customer workflow after sign-in without accepting general redirect destinations. */
export function customerReturnPath(value: unknown): string | undefined {
  const booking = bookingReturnPath(value);
  if (booking) return booking;
  if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return undefined;
  if (value === '/learn/payments' || value === '/learn/refunds') return value;
  const payment = /^(\/learn\/(?:refunds|payments(?:\/(?:charges|transfers|plans))?))\/([^/?#]+)$/.exec(value);
  if (payment) return z.uuid().safeParse(payment[2]).success ? value : undefined;
  const detail = /^\/learn\/packages\/([^/?#]+)$/.exec(value);
  if (detail) {
    const id = z.uuid().safeParse(detail[1]);
    return id.success ? `/learn/packages/${id.data}` : undefined;
  }
  if (!/^\/learn\/packages(?:\?[^?#]*)?$/.test(value)) return undefined;
  const params = new URLSearchParams(value.split('?')[1] || '');
  if (new Set(params.keys()).size !== params.size || [...params.keys()].some(key => !['learner', 'contract'].includes(key))) return undefined;
  const result = new URLSearchParams();
  for (const key of ['learner', 'contract']) {
    if (!params.has(key)) continue;
    const id = z.uuid().safeParse(params.get(key));
    if (!id.success) return undefined;
    result.set(key, id.data);
  }
  return `/learn/packages${result.size ? `?${result}` : ''}`;
}
