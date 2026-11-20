import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AdminSchedule } from '@/components/booking/admin-schedule';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';
import { WorkflowOperationsWorkspace } from '@/components/workflow-import/operational-workspaces';

export const metadata: Metadata = { title: 'Session operations | Git Tutor', robots: { index: false, follow: false } };
export default async function AdminSchedulePage({ searchParams }: { searchParams: Promise<{ occurrence?: string }> }) { const account = await requireAccount('admin'); const { occurrence } = await searchParams; const id = typeof occurrence === 'string' && /^[0-9a-f-]{36}$/i.test(occurrence) ? occurrence : undefined; return <PortalShell kind="admin" account={account} title={copy.adminTitle} description={copy.adminDescription} activePath="/admin/schedule" showAccount={false}><WorkflowOperationsWorkspace workspace="admin" view="sessions" collapsed={Boolean(id)}><AdminSchedule key={id || 'all'} initialOccurrence={id} /></WorkflowOperationsWorkspace></PortalShell>; }
