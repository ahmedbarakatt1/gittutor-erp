import Link from 'next/link';
import { sessionLength, tuition } from '../../modules/catalog/public-tuition';
import styles from './tuition.module.css';

/** Separate customer-only contract: never import compensation authoring data here. */
export function TuitionComparison() {
  return <section className={styles.comparison} aria-label="Session pricing">
    <div className={styles.context}><h2>A session built around your material.</h2><p>{sessionLength} to work through your slides, course notes and questions.</p><p>Every price is <strong>per student, per session</strong>. Choose individual support or bring a study group.</p></div>
    <div className={styles.rates}>
      <div className={styles.table} role="table" aria-label="Individual and group tuition">
        <div className={styles.tableHeading} role="row"><span role="columnheader">Study format</span><span role="columnheader">Price per student</span></div>
        {tuition.tiers.map(tier => <div className={styles.rate} role="row" key={tier.format}>
          <div role="cell"><h3>{tier.students === 1 ? 'Individual' : `Group of ${tier.students}`}</h3><p>{tier.students === 1 ? 'One student, focused support.' : `${tier.students} students learning together.`}</p></div>
          <div role="cell" className={styles.price}><span className={styles.currency}>EGP</span> <strong>{tier.price_minor / 100}</strong></div>
        </div>)}
      </div>
      <p className={styles.note}>Send your material and preferred times. We’ll review your request, find the right tutor and confirm the schedule and terms with you.</p>
      <Link className={styles.action} href="/learn/requests">Request a session <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></Link>
    </div>
  </section>;
}
