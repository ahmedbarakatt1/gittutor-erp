import Link from 'next/link';
import type { PublicOffer } from '@/modules/catalog/queries';
import { bookingCopy as copy } from '@/locales/booking';
import { SessionTime } from './shared';
import styles from './booking.module.css';

export function PublicSchedule({ offer }: { offer: PublicOffer }) {
  const sessions = offer.availability.next_occurrences;
  return <section className={styles.section} aria-labelledby="upcoming-sessions"><h2 id="upcoming-sessions">{copy.publicSchedule}</h2><p>{copy.allTimes}</p><p>{copy.availabilityNotice}</p>{sessions.length ? <ul className={styles.list}>{sessions.map(item => <li key={item.occurrence_id}><SessionTime start={item.start_at} end={item.end_at} /><p>{copy.withTutor} <Link className={styles.link} href={`/tutors/${item.tutor.tutor_id}`}>{item.tutor.display_name}</Link></p><p>{copy.seats(item.available_seats)}</p><Link className={styles.link} href={`/learn/bookings?offer=${offer.offer_id}&occurrence=${item.occurrence_id}`}>{copy.continue}</Link></li>)}</ul> : <p>{copy.noSchedule}</p>}{offer.availability.has_more && <Link className={styles.link} href={`/learn/bookings?offer=${offer.offer_id}`}>{copy.allScheduled}</Link>}</section>;
}
