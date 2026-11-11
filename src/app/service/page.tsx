import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';

export const metadata: Metadata = { title: 'Customer service | Git Tutor', robots: { index: false, follow: false } };
export default async function ServicePage() { return <PortalShell kind="service" account={await requireAccount('customer_service')} />; }
