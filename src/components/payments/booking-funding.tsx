'use client';

import Link from 'next/link';
import type { AdminOccurrence, CustomerEnrollment } from '@/modules/booking/queries';
import { paymentCopy as copy } from '@/locales/payments';
import { bookingCopy } from '@/locales/booking';
import { IdentityForm } from '../identity-form';
import { money } from '../booking/shared';
import { State } from './shared';
import styles from './payments.module.css';

import detail from '../booking/reservation.module.css';
import formStyles from '../auth.module.css';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { bookingCopy as arabicBookingCopy } from '@/locales/ar-transaction/booking';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy, bookingCopy },
  ar: { copy: arabicPaymentCopy, bookingCopy: arabicBookingCopy },
};

export function BookingFunding({ item, onSaved }: { item: CustomerEnrollment; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy, bookingCopy } = textByLanguage[uiLanguage];

  const funding = item.funding;
  const waiting = item.state === 'held';
  const ready = funding.integration_state === 'ready';
  const needsPayment = waiting && !item.is_provisional && Boolean(item.quote.accepted_at) && ready && funding.reason === 'INSUFFICIENT_FUNDS';

  return <section className={detail.funding} aria-labelledby="confirmation-heading">
    <div className={detail.titleLine}>
      <h2 id="confirmation-heading">{copy.bookingPayment}</h2>
      {ready && funding.balance_minor !== null && <span>{copy.balance} <strong>{money(funding.balance_minor, 'EGP', uiLanguage)}</strong></span>}
    </div>
    {ready ? <>
      {waiting && funding.additional_required_minor > 0 && <p>{copy.additional} <strong>{money(funding.additional_required_minor, 'EGP', uiLanguage)}</strong></p>}
      {waiting && <p data-testid="confirmation-explanation" className={detail.explanation}>{copy.reasons[funding.reason] || bookingCopy.fundingReady} {copy.automaticConfirmation}</p>}
      {funding.charge_id ?
        <Link className={needsPayment ? `${formStyles.primary} ${detail.fundingAction}` : styles.link} href={`/learn/payments/charges/${funding.charge_id}`}>{copy.openInstructions}</Link>
        : item.quote.accepted_at && !item.is_provisional && <IdentityForm action={`enrollments/${item.enrollment_id}/charge`} submitLabel={copy.prepareInstructions}
          successMessage={copy.instructionsPrepared} resettable={false} payload={() => ({ expected_version: item.version })} onSaved={onSaved}>{null}</IdentityForm>}
      <details><summary>{copy.paymentBreakdown}</summary>
        <p>{copy.outcome}: <State value={item.occurrence.state} /></p>
        {!waiting && <p>{copy.reasons[funding.reason] || bookingCopy.fundingReady}</p>}
        <dl className={detail.quoteFacts}>
          {funding.net_charge_minor !== null && <div><dt>{copy.net}</dt><dd>{money(funding.net_charge_minor, 'EGP', uiLanguage)}</dd></div>}
          {funding.allocated_minor !== null && <div><dt>{copy.cash}</dt><dd>{money(funding.allocated_minor, 'EGP', uiLanguage)}</dd></div>}
          {funding.allocated_package_value_minor !== null && <div><dt>{copy.packageValue}</dt><dd>{money(funding.allocated_package_value_minor, 'EGP', uiLanguage)}</dd></div>}
          <div><dt>{copy.additional}</dt><dd>{money(funding.additional_required_minor, 'EGP', uiLanguage)}</dd></div>
        </dl>
      </details>
    </> : <p data-testid="confirmation-explanation">{bookingCopy.fundingPending}</p>}
  </section>;
}
export function AdminConfirmation({ item, onSaved }: { item: AdminOccurrence; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy, bookingCopy } = textByLanguage[uiLanguage];

  const active = item.roster.filter(row => ['held', 'confirmed'].includes(row.state) && !row.provisional_amendment_id);
  const ready = active.length >= (item.occurrence.target_tier || 1) && active.every(row => row.funding.integration_state === 'ready' && row.funding.eligible) && Boolean(item.fee_agreement?.is_current);
  return <section className={styles.section}><h3>{copy.bookingPayment}</h3><p>{copy.confirmationDescription}</p><p>{copy.outcome}: <State value={item.occurrence.state} /></p><ul className={styles.list}>{active.map(row => <li key={row.enrollment_id}><strong>{row.display_name}</strong><p>{row.funding.integration_state === 'ready' ? copy.reasons[row.funding.reason] || bookingCopy.fundingReady : bookingCopy.fundingPending}</p></li>)}</ul>{item.occurrence.state === 'forming' ? <IdentityForm action={`occurrences/${item.occurrence.occurrence_id}/confirm`} submitLabel={bookingCopy.confirm} successMessage={copy.confirmed} resettable={false} disabled={!ready} payload={() => ({ expected_version: item.occurrence.version })} onSaved={onSaved}>{null}</IdentityForm> : <p>{bookingCopy.states[item.occurrence.state] || item.occurrence.state}</p>}</section>;
}
