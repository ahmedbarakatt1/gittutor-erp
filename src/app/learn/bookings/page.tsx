import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerBookings } from '@/components/booking/customer-bookings';
import { bookingCopy as copy } from '@/locales/booking';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';

export const metadata: Metadata = { title: 'Your sessions | Git Tutor', robots: { index: false, follow: false } };
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ offer?: string; occurrence?: string }> }) {
  const query = await searchParams;
  const valid = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  const offer = valid(query.offer); const occurrence = offer ? valid(query.occurrence) : undefined;
  const selection = new URLSearchParams(); if (offer) selection.set('offer', offer); if (occurrence) selection.set('occurrence', occurrence);
  const account = await requireAccount('student', `/learn/bookings${selection.size ? `?${selection}` : ''}`);
  return <PortalShell kind="learn" account={account} title={copy.title} description={copy.description} activePath="/learn/bookings" showAccount={false}><WorkflowOperationsWorkspace view="sessions" collapsed={Boolean(offer || occurrence)}><CustomerBookings offerId={valid(query.offer)} initialOccurrence={valid(query.occurrence)} /></WorkflowOperationsWorkspace></PortalShell>;
}
