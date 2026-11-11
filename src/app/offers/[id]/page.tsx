import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicShell, CatalogUnavailable, formatTuition } from '@/components/catalog/public-shell';
import { OfferTerms } from '@/components/catalog/offer-terms';
import { PublicSchedule } from '@/components/booking/public-schedule';
import { catalogCopy as copy } from '@/locales/catalog';
import { publicSupabase } from '@/server/supabase';
import { listPublicOffers, type PublicOffer } from '@/modules/catalog/queries';
import styles from '@/components/catalog/catalog.module.css';

export const metadata: Metadata = { title: 'Offer and terms | Git Tutor' };
export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let offer: PublicOffer | undefined; let unavailable = false;
  try { offer = (await listPublicOffers(publicSupabase(), { offer_id: id, limit: 1 })).items[0]; } catch { unavailable = true; }
  if (!unavailable && !offer) notFound();
  return <PublicShell active="offers"><p className={styles.breadcrumb}><Link href="/offers" className={styles.textLink}>{copy.back}</Link></p>
    {unavailable || !offer ? <CatalogUnavailable retry={`/offers/${id}`} /> : <><div className={styles.intro}><h1>{offer.title}</h1><p>{copy.formats[offer.format]} · {offer.subject.title}</p></div><div className={styles.detail}>
      <div><h2>{copy.overview}</h2><dl className={styles.facts}><div><dt>{copy.duration}</dt><dd>{offer.duration_minutes} {copy.minutes}</dd></div><div><dt>{copy.groupSize}</dt><dd>{offer.format === 'group' ? `${offer.target_tier} ${copy.students}` : copy.oneLearner}</dd></div><div><dt>{copy.capacity}</dt><dd>{offer.capacity}</dd></div><div><dt>{copy.format}</dt><dd>{copy.formats[offer.format]}</dd></div></dl><OfferTerms terms={offer.policy_summary} policyId={offer.policy_version_id} /></div>
      <aside className={styles.booking} aria-label={copy.tuition}><h2>{copy.tuition}</h2><p className={styles.bookingPrice}>{formatTuition(offer.seat_price_minor, offer.currency)}</p><p className={styles.bookingUnit}>{copy.perStudent}</p>{offer.availability.scheduled_occurrences > 0 ? <PublicSchedule offer={offer} /> : <><h3>{copy.unscheduled}</h3><p id="reservation-prerequisite">{copy.unscheduledDescription}</p><button type="button" className={styles.button} disabled aria-describedby="reservation-prerequisite">{copy.reserve}</button></>}</aside>
    </div></>}
  </PublicShell>;
}
