import { getSiteLanguage } from '@/server/site-language';
import { CatalogNotFound } from '@/components/catalog/public-shell';
export default async function NotFound() { return <CatalogNotFound language={await getSiteLanguage()} />; }
