import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { TutorSchedule } from '@/components/booking/tutor-schedule';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';

export const metadata: Metadata = { title: 'Teaching schedule | Git Tutor', robots: { index: false, follow: false } };
export default async function TutorSchedulePage({ searchParams }: { searchParams: Promise<{ occurrence?: string }> }) { const account = await requireAccount('tutor'); const { occurrence } = await searchParams; const id = typeof occurrence === 'string' && /^[0-9a-f-]{36}$/i.test(occurrence) ? occurrence : undefined; return <PortalShell kind="tutor" account={account} title={copy.tutorTitle} description={copy.tutorDescription} activePath="/tutor/schedule" showAccount={false}><TutorSchedule key={id || 'all'} initialOccurrence={id} /></PortalShell>; }
