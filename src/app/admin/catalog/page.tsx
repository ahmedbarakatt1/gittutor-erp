import type { Metadata } from 'next';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AdminCatalog } from '@/components/catalog/admin-catalog';
import { catalogCopy } from '@/locales/catalog';
import { authConfiguration } from '@/server/supabase';

export const metadata: Metadata = { title: 'Catalog and policies | Git Tutor', robots: { index: false, follow: false } };
export default async function CatalogAdminPage() {
  return <PortalShell kind="admin" account={await requireAccount('admin')} title={catalogCopy.admin.title} description={catalogCopy.admin.description} activePath="/admin/catalog" showAccount={false}><AdminCatalog isolated={authConfiguration().isolated} /></PortalShell>;
}
