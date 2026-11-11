import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { CustomerPackageDetail } from '@/components/packages/package-detail';
import { packageCopy as copy } from '@/locales/packages';

export const metadata: Metadata = { title: 'Package details | Git Tutor', robots: { index: false, follow: false } };
export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const account = await requireAccount('student', `/learn/packages/${id}`);
  return <PortalShell kind="learn" account={account} title={copy.detailTitle} description={copy.creditValueNote} activePath="/learn/packages" showAccount={false}><CustomerPackageDetail id={id} /></PortalShell>;
}
