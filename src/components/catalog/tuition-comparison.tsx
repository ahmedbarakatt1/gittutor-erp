import Link from 'next/link';
import { sessionLength, tuition } from '../../modules/catalog/public-tuition';
import styles from './tuition.module.css';

/** Separate customer-only contract: never import compensation authoring data here. */
export function TuitionComparison() {
  return <section className={styles.comparison} aria-label="Session pricing">
    <div className={styles.context}>
      <h1>Clear prices. Your course, your pace.</h1>
      <p>Work through your slides, course notes and questions in {sessionLength}. Every price is <strong>per student, per session</strong>.</p>
      <Link className={styles.action} href="/learn/requests">Request a session <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></Link>
    </div>
    <div>
      <table className={styles.table} aria-label="Individual and group tuition">
        <thead><tr><th scope="col">Study format</th><th scope="col">Price per student</th></tr></thead>
        <tbody>{tuition.tiers.map(tier => (
          <tr key={tier.format}>
            <th scope="row">
              <strong>{tier.students === 1 ? 'Individual' : `Group of ${tier.students}`}</strong>
              <p>{tier.students === 1 ? 'One student, focused support.' : `${tier.students} students learning together.`}</p>
            </th>
            <td className={styles.price}>EGP <strong>{tier.price_minor / 100}</strong></td>
          </tr>
        ))}</tbody>
      </table>
      <p className={styles.note}>Send your material and preferred times. We’ll review your request, find the right tutor and confirm the schedule and terms with you.</p>
    </div>
  </section>;
}
