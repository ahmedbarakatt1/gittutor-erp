import Link from 'next/link';
import type { PackageContract } from '@/modules/packages/queries';
import { packageCopy as copy } from '@/locales/packages';
import { money } from '../booking/shared';
import { credits } from './shared';
import styles from './packages.module.css';

export function PackageTerms({ contract, offers, environment }: { contract: PackageContract['contract']; offers: PackageContract['eligible_offers']; environment?: string }) {
  return <section className={styles.section} aria-label={copy.terms}>
    <h3>{copy.terms}</h3>{environment === 'synthetic_development' && <p>{copy.development}</p>}
    <dl className={styles.facts}><div><dt>{copy.purchasedCredits}</dt><dd><bdi dir="auto">{credits(contract.grant_credit_quanta)}</bdi></dd></div><div><dt>{copy.duration}</dt><dd><bdi dir="auto">{contract.base_duration_minutes}</bdi></dd></div><div><dt>{copy.price}</dt><dd><bdi dir="auto">{money(contract.purchase_value_minor, contract.currency)}</bdi></dd></div><div><dt>{copy.coverage}</dt><dd><bdi dir="auto">{copy.coverageRules[contract.coverage_rule]}</bdi></dd></div><div><dt>{copy.expiry}</dt><dd><bdi dir="auto">{contract.expiry_mode === 'none' ? copy.neverExpires : copy.expiryDays(contract.expiry_days!)}</bdi></dd></div></dl>
    <p>{copy.creditBasis(contract.base_duration_minutes)}</p><p>{copy.activation}</p><p>{contract.coverage_rule === 'named_entitlement_covers_eligible_occurrence' ? copy.fullNamed : copy.valueCoverageTerms}</p><p>{copy.carryoverTerms}</p><p>{copy.partialTerms}</p><p>{copy.refundTerms}</p>
    <h3>{copy.eligibleOffers}</h3><ul className={styles.list}>{offers.map(offer => <li key={offer.offer_id}>{offer.availability === 'currently_published' ? <Link className={styles.link} href={`/offers/${offer.offer_id}`}>{offer.title}</Link> : <span>{offer.availability === 'historical' ? `${offer.title} · ${copy.historical}` : copy.noOffer}</span>}<p>{offer.format === 'group' ? copy.groupFormat : copy.privateFormat} · {offer.duration_minutes} min</p></li>)}</ul>
    <p className={styles.reference}>{copy.termsReference}: {contract.package_policy_version_id}</p>
  </section>;
}
