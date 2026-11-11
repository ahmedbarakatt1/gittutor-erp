import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell, CatalogUnavailable } from '@/components/catalog/public-shell';
import { OfferList } from '@/components/catalog/offer-list';
import { catalogCopy as copy } from '@/locales/catalog';
import { publicSupabase } from '@/server/supabase';
import { listPublicOffers, type PublicOffer } from '@/modules/catalog/queries';
import styles from '@/components/catalog/catalog.module.css';
import { resolveCairoLocalTime } from '@/modules/booking/scheduling';
import { bookingCopy } from '@/locales/booking';

export const metadata: Metadata = { title: 'Tutoring offers | Git Tutor', description: 'Compare published tuition, private sessions and small-group terms.' };
export default async function OffersPage({ searchParams }: { searchParams: Promise<{ subject_id?: string; format?: string; cursor?: string; from_local?: string; to_local?: string; from_instant?: string; to_instant?: string }> }) {
  const input = await searchParams;
  const validSubject = input.subject_id && /^[0-9a-f-]{36}$/i.test(input.subject_id) ? input.subject_id : undefined;
  const validFormat = input.format === 'private' || input.format === 'group' ? input.format : undefined;
  function localFilter(local: unknown, selected: unknown) {
    if (!local) return { candidates: [], instant: undefined, invalid: false };
    try { if (typeof local !== 'string') throw new Error('INVALID_LOCAL_TIME'); const candidates = resolveCairoLocalTime(local); const instant = candidates.length === 1 ? candidates[0].instant : candidates.find(item => item.instant === selected)?.instant; return { candidates, instant, invalid: !instant }; }
    catch { return { candidates: [], instant: undefined, invalid: true }; }
  }
  const from = localFilter(input.from_local, input.from_instant); const to = localFilter(input.to_local, input.to_instant);
  const invalidWindow = Boolean(from.instant && to.instant && Date.parse(from.instant) >= Date.parse(to.instant));
  const invalid = Boolean(input.subject_id && !validSubject || input.format && !validFormat || from.invalid || to.invalid || invalidWindow);
  let offers: PublicOffer[] = []; let next: string | null = null; let unavailable = false;
  const subjects = new Map<string, PublicOffer['subject']>();
  try {
    const client = publicSupabase();
    const selected = await listPublicOffers(client, { subject_id: validSubject, format: validFormat, cursor: input.cursor, limit: 25, ...(!invalidWindow ? { from: from.instant, to: to.instant } : {}) });
    offers = selected.items; next = selected.next_cursor;
    for (const subject of selected.subjects) subjects.set(subject.subject_id, subject);
  } catch { unavailable = true; }
  const nextParams = new URLSearchParams();
  if (validSubject) nextParams.set('subject_id', validSubject); if (validFormat) nextParams.set('format', validFormat); if (next) nextParams.set('cursor', next);
  for (const key of ['from_local', 'to_local', 'from_instant', 'to_instant'] as const) if (typeof input[key] === 'string' && input[key]) nextParams.set(key, input[key]);
  return <PublicShell active="offers"><div className={styles.intro}><h1>{copy.offersTitle}</h1><p>{copy.offersDescription}</p></div>
    <form className={styles.filter} action="/offers" method="get">
      <div><label htmlFor="subject-filter">{copy.subject}</label><select id="subject-filter" name="subject_id" defaultValue={validSubject || ''}><option value="">{copy.allSubjects}</option>{Array.from(subjects.values()).map(subject => <option key={subject.subject_id} value={subject.subject_id}>{subject.title}</option>)}</select></div>
      <div><label htmlFor="format-filter">{copy.format}</label><select id="format-filter" name="format" defaultValue={validFormat || ''}><option value="">{copy.allFormats}</option><option value="private">{copy.formats.private}</option><option value="group">{copy.formats.group}</option></select></div>
      <button className={styles.button} type="submit">{copy.applyFilters}</button>
      <details className={styles.timeFilters} open={Boolean(input.from_local || input.to_local)}><summary>{bookingCopy.timeFilters}</summary><p>{bookingCopy.allTimes}</p><div>{([{ key: 'from', label: bookingCopy.fromTime, result: from }, { key: 'to', label: bookingCopy.toTime, result: to }] as const).map(({ key, label, result }) => <div key={key}><label htmlFor={`${key}-time`}>{label}</label><input id={`${key}-time`} name={`${key}_local`} type="datetime-local" defaultValue={typeof input[`${key}_local`] === 'string' ? input[`${key}_local`] : ''} />{result.candidates.length > 1 && <><label htmlFor={`${key}-offset`}>{bookingCopy.chooseTimeOffset}</label><select id={`${key}-offset`} name={`${key}_instant`} required defaultValue={result.instant || ''}><option value="">{bookingCopy.chooseOffset}</option>{result.candidates.map(candidate => <option key={candidate.instant} value={candidate.instant}>{`UTC+${String(Math.floor(candidate.offset_minutes / 60)).padStart(2, '0')}:${String(candidate.offset_minutes % 60).padStart(2, '0')}`}</option>)}</select></>}{result.invalid && result.candidates.length === 0 && <p role="alert">{bookingCopy.localSkipped}</p>}</div>)}</div></details>
    </form>
    {invalid && <p role="alert">{copy.invalidFilters}</p>}
    {(validSubject || validFormat || input.from_local || input.to_local) && <p className={styles.reset}><Link className={styles.textLink} href="/offers">{copy.clearFilters}</Link></p>}
    {unavailable ? <CatalogUnavailable /> : <section className={styles.results} aria-label={copy.availableOffers}><OfferList offers={offers} />{next && <Link className={styles.button} href={`/offers?${nextParams}`}>{copy.nextPage}</Link>}</section>}
  </PublicShell>;
}
