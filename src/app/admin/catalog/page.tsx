import { pageMetadata } from '@/server/page-metadata';
import { requireAccount } from '@/server/auth';
import { PortalShell } from '@/components/portal-shell';
import { AdminCatalog } from '@/components/catalog/admin-catalog';
import { catalogCopy } from '@/locales/catalog';
import { authConfiguration } from '@/server/supabase';
import { catalogCopy as arabicCatalogCopy } from '@/locales/ar-transaction/catalog';
import { getSiteLanguage } from '@/server/site-language';


const textByLanguage = {
  en: { catalogCopy },
  ar: { catalogCopy: arabicCatalogCopy },
};

export const generateMetadata = pageMetadata({ title: 'Catalog and policies | Git Tutor', robots: { index: false, follow: false } });
export default async function CatalogAdminPage() {
  const uiLanguage = await getSiteLanguage();
  const { catalogCopy } = textByLanguage[uiLanguage];

  return <PortalShell kind="admin" account={await requireAccount('admin')} title={catalogCopy.admin.title} description={catalogCopy.admin.description} activePath="/admin/catalog" showAccount={false}><AdminCatalog isolated={authConfiguration().isolated} /></PortalShell>;
}
