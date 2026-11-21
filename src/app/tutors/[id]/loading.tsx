import { getSiteLanguage } from '@/server/site-language';
import { CatalogLoading } from '@/components/catalog/public-shell';
export default async function Loading() { return <CatalogLoading language={await getSiteLanguage()} />; }
