import Link from 'next/link';
import type { PublicOffer } from '@/modules/catalog/queries';
import { catalogCopy as copy } from '@/locales/catalog';
import { formatTuition } from './public-shell';
import styles from './catalog.module.css';
import { SessionTime } from '../booking/shared';

export function OfferList({ offers }: { offers: PublicOffer[] }) {
  if (!offers.length) return <section className={styles.empty}><h2>{copy.noOffers}</h2><p>{copy.noOffersDescription}</p></section>;
  return <ul className={styles.offerList}>{offers.map(offer => <li key={offer.offer_id} className={styles.offer}>
    <div><h3><Link href={`/offers/${offer.offer_id}`}>{offer.title}</Link></h3>
      <p className={styles.offerMeta}><span>{copy.formats[offer.format]}</span><span>{offer.duration_minutes} {copy.minutes}</span><span>{offer.format === 'group' ? `${offer.target_tier} ${copy.students}` : copy.oneLearner}</span></p>
      <p className={styles.schedule}>{offer.availability.next_occurrences[0] ? <SessionTime start={offer.availability.next_occurrences[0].start_at} end={offer.availability.next_occurrences[0].end_at} /> : copy.unscheduled}</p>
    </div>
    <div className={styles.offerPrice}><strong>{formatTuition(offer.seat_price_minor, offer.currency)}</strong><span>{copy.perStudent}</span><Link className={styles.textLink} href={`/offers/${offer.offer_id}`}>{copy.openOffer}</Link></div>
  </li>)}</ul>;
}
