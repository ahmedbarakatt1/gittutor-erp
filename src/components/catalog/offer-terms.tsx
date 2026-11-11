import type { PublicPolicySummary } from '@/modules/catalog/queries';
import { catalogCopy as copy } from '@/locales/catalog';
import styles from './catalog.module.css';
import { formatTuition } from './public-shell';

function phrase(dictionary: Record<string, string>, key: unknown) { return dictionary[String(key)] || ''; }
export function OfferTerms({ terms, policyId }: { terms: PublicPolicySummary; policyId: string }) {
  const text = copy.termsText;
  const contract = typeof terms.package_contract === 'object' && terms.package_contract !== null ? terms.package_contract as Record<string, unknown> : null;
  return <section className={styles.terms} aria-labelledby="offer-terms"><h2 id="offer-terms">{copy.terms}</h2>
    <div className={styles.term}><h3>{copy.deposit}</h3><p>{text.deposit(terms.deposit_basis_points / 100)}</p><p>{text.hold(terms.hold_minutes)}</p><p>{text.deadline(Number(terms.confirmation_deadline_minutes_before_start))}</p></div>
    <div className={styles.term}><h3>{copy.cancellation}</h3><ul>{terms.customer_cancellation_windows.map((window, index) => <li key={index}>{text.window(window.minimum_minutes_before_start, window.maximum_minutes_before_start_exclusive, window.refund_basis_points / 100)}</li>)}</ul><p>{text.cancellation}</p></div>
    {terms.offer_format === 'group' && <><div className={styles.term}><h3>{copy.formation}</h3><p>{text.groupMinimum(Number(terms.group_minimum_size))}</p><p>{phrase(text.formation, terms.formation_failure_action)}</p><p>{text.belowMinimum}</p></div><div className={styles.term}><h3>{copy.amendments}</h3><p>{text.amendments(Number(terms.amendment_acceptance_minutes), Number(terms.latest_amendment_minutes_before_start))}</p><p>{terms.post_confirmation_dropout_price_guarantee ? text.guarantee : text.noGuarantee}</p></div></>}
    <div className={styles.term}><h3>{copy.delivery}</h3><p>{phrase(text.noShow, terms.learner_no_show_rule)}</p><p>{phrase(text.departure, terms.individual_early_departure_rule)}</p><p>{phrase(text.partial, terms.partial_class_remedy_rule)}</p></div>
    <div className={styles.term}><h3>{copy.refunds}</h3><ul>{terms.allowed_refund_remedies.map(remedy => <li key={remedy}>{phrase(text.remedies, remedy)}</li>)}</ul></div>
    <div className={styles.term}><h3>{copy.package}</h3>{terms.package_enabled && contract ? <><p>{text.packageSessions(Number(contract.grant_credit_quanta) / 1000, Number(contract.base_duration_minutes), formatTuition(Number(contract.purchase_value_minor)))}</p><p>{phrase(text.packageCoverage, contract.coverage_rule)}</p><p>{text.packageExpiry(contract.expiry_mode === 'none' ? null : Number(contract.expiry_days))}</p><p>{text.packageRules}</p></> : <p>{copy.packageDisabled}</p>}</div>
    <p className={styles.termsReference}>{copy.approvedTerms}: {policyId}</p>
  </section>;
}
