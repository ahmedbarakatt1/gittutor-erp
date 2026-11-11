import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell, CatalogUnavailable } from '@/components/catalog/public-shell';
import { OfferList } from '@/components/catalog/offer-list';
import { catalogCopy as copy } from '@/locales/catalog';
import { publicSupabase } from '@/server/supabase';
import { listPublicOffers, type PublicOffer } from '@/modules/catalog/queries';
import styles from '@/components/catalog/catalog.module.css';

export const metadata: Metadata = { title: 'Tutoring offers | Git Tutor', description: 'Compare published tuition, private sessions and small-group terms.' };
export default async function OffersPage({ searchParams }: { searchParams: Promise<{ subject_id?: string; format?: string; cursor?: string }> }) {
  const input = await searchParams;
  const validSubject = input.subject_id && /^[0-9a-f-]{36}$/i.test(input.subject_id) ? input.subject_id : undefined;
  const validFormat = input.format === 'private' || input.format === 'group' ? input.format : undefined;
  const invalid = Boolean(input.subject_id && !validSubject || input.format && !validFormat);
  let offers: PublicOffer[] = []; let next: string | null = null; let unavailable = false;
  const subjects = new Map<string, PublicOffer['subject']>();
  try {
    const client = publicSupabase();
    const selected = await listPublicOffers(client, { subject_id: validSubject, format: validFormat, cursor: input.cursor, limit: 25 });
    offers = selected.items; next = selected.next_cursor;
    let cursor: string | null = null;
    do { const page = await listPublicOffers(client, { cursor, limit: 100 }); for (const offer of page.items) subjects.set(offer.subject.subject_id, offer.subject); cursor = page.next_cursor; } while (cursor);
  } catch { unavailable = true; }
  const nextParams = new URLSearchParams();
  if (validSubject) nextParams.set('subject_id', validSubject); if (validFormat) nextParams.set('format', validFormat); if (next) nextParams.set('cursor', next);
  return <PublicShell active="offers"><div className={styles.intro}><h1>{copy.offersTitle}</h1><p>{copy.offersDescription}</p></div>
    <form className={styles.filter} action="/offers" method="get">
      <div><label htmlFor="subject-filter">{copy.subject}</label><select id="subject-filter" name="subject_id" defaultValue={validSubject || ''}><option value="">{copy.allSubjects}</option>{Array.from(subjects.values()).map(subject => <option key={subject.subject_id} value={subject.subject_id}>{subject.title}</option>)}</select></div>
      <div><label htmlFor="format-filter">{copy.format}</label><select id="format-filter" name="format" defaultValue={validFormat || ''}><option value="">{copy.allFormats}</option><option value="private">{copy.formats.private}</option><option value="group">{copy.formats.group}</option></select></div>
      <button className={styles.button} type="submit">{copy.applyFilters}</button>
    </form>
    {invalid && <p role="alert">{copy.invalidFilters}</p>}
    {(validSubject || validFormat) && <p className={styles.reset}><Link className={styles.textLink} href="/offers">{copy.clearFilters}</Link></p>}
    {unavailable ? <CatalogUnavailable /> : <section className={styles.results} aria-label={copy.availableOffers}><OfferList offers={offers} />{next && <Link className={styles.button} href={`/offers?${nextParams}`}>{copy.nextPage}</Link>}</section>}
  </PublicShell>;
}
