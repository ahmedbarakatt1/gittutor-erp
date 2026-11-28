'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { AdminEnrollmentTransfer, EnrollmentTransfer, TransferCarryoverOption } from '@/modules/booking/enrollment-transfers';
import type { AdminOccurrence } from '@/modules/booking/queries';
import { transferCopy as copy } from '@/locales/enrollment-transfers';
import { IdentityForm, TextField } from '../identity-form';
import { AmountField, amountField, PaymentReadState, usePaymentClock, usePaymentList } from '../payments/shared';
import { CreditField, creditField, credits } from '../packages/shared';
import { TransferCustomerDetails } from './customer-transfer';
import { CairoTimestamp, Check, ReadState, money, useBookingRecord } from './shared';
import styles from './booking.module.css';
import formStyles from '../auth.module.css';
import { transferCopy as arabicTransferCopy } from '@/locales/ar-transaction/enrollment-transfers';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicTransferCopy },
};


export function StaffTransferReview({ id: initialId, view, onSaved }: { id: string; view: 'admin' | 'tutor'; onSaved?: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [id, setId] = useState(initialId), [applied, setApplied] = useState(''), decision = useId(), now = usePaymentClock();
  const record = useBookingRecord<EnrollmentTransfer>(`enrollment-transfer-proposals/${id}?view=${view}`), proposal = record.data?.view === view ? record.data : undefined;
  const current = proposal && now > 0 && now < Date.parse(proposal.expires_at);
  function saved() { record.reload(); onSaved?.(); }
  const teaching = proposal?.source_teaching_terms;
  return <details className={styles.detail} data-proposal-id={id}><summary>{copy.review}{proposal && ` · ${copy.states[proposal.state]}`}</summary><ReadState pending={!proposal} {...record} />{proposal && <><p>{copy.expires}: <CairoTimestamp value={proposal.expires_at} /></p>{proposal.superseded_by_proposal_id && <button type="button" className={formStyles.signout} onClick={() => setId(proposal.superseded_by_proposal_id!)}>{copy.replacement}</button>}{teaching && <section className={styles.private}><h3>{copy.teaching}</h3><dl className={styles.facts}><div><dt>{copy.previousFee}</dt><dd>{money(teaching.old_fee_minor, 'EGP', uiLanguage)}</dd></div><div><dt>{copy.revisedFee}</dt><dd>{money(teaching.reviewed_fee_minor, 'EGP', uiLanguage)}</dd></div></dl><p>{copy.feeExplanation}</p></section>}{proposal.view === 'tutor' && (proposal.accepted_at ? <p className={formStyles.saved}>{copy.tutorAccepted}</p> : ['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`operation-proposals/${id}/accept`} submitLabel={copy.tutorAccept} successMessage={copy.tutorAccepted} disabled={!current || !proposal.can_accept} resettable={false} onSaved={saved} payload={() => ({ terms_hash: proposal.terms_hash, expected_version: proposal.version })}><Check name="teaching_consent" label={copy.tutorConsent} /></IdentityForm>)}{proposal.view === 'tutor' && ['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`operation-proposals/${id}/decline`} submitLabel={copy.decline} successMessage={copy.declined} resettable={false} onSaved={saved} payload={form => ({ reason: String(form.get('reason')), expected_version: proposal.version })}><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>}{proposal.view === 'admin' && <><TransferCustomerDetails data={proposal.customer} state={proposal.state} showPaymentLink={false} />{proposal.destination_fee_snapshot && <p className={styles.private}>{copy.destinationFee}: {money(proposal.destination_fee_snapshot.fee_minor, 'EGP', uiLanguage)}</p>}{!proposal.customer.terms && !proposal.superseded_by_proposal_id && <TransferReviewForm proposal={proposal} onSaved={result => { setId(String(result.proposal_id)); onSaved?.(); }} />}<ul>{proposal.required_actions.map(action => <li key={action}>{copy.actions[action]}</li>)}</ul>{proposal.customer.terms && ['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`operation-proposals/${id}/approve`} submitLabel={copy.approval} successMessage={copy.approved} resettable={false} onSaved={saved} payload={form => ({ terms_hash: proposal.terms_hash, decision: String(form.get('decision')), reason: String(form.get('reason')), expected_version: proposal.version })}><div className={formStyles.field}><label htmlFor={decision}>{copy.decision}</label><select id={decision} name="decision" defaultValue="rejected"><option value="approved" disabled={proposal.required_acceptances.some(row => !row.accepted_at) || !current || (proposal.customer.funding?.carryover_accepted_count ?? 0) < (proposal.customer.funding?.carryover_required_count ?? 0)}>{copy.approve}</option><option value="rejected">{copy.reject}</option></select></div><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>}{proposal.state === 'approved' && <IdentityForm action={`enrollments/${proposal.customer.source.enrollment_id}/transfer`} submitLabel={copy.apply} successMessage={copy.applySaved} resettable={false} disabled={!current || !proposal.can_apply} onSaved={result => { setApplied(String(result.new_enrollment_id)); saved(); }} payload={() => ({ destination_occurrence_id: proposal.customer.requested_destination.occurrence_id, accepted_proposal_id: id, expected_version: proposal.source_version })}><p>{copy.applyDescription}</p>{!proposal.can_apply && <p>{copy.waiting}</p>}</IdentityForm>}{(applied || proposal.state === 'committed') && proposal.customer.destination && <p><Link className={styles.link} href={`/admin/schedule?occurrence=${proposal.customer.destination.occurrence_id}`}>{copy.openBooking}</Link></p>}</>}</>}</details>;
}

function TransferReviewForm({ proposal, onSaved }: { proposal: AdminEnrollmentTransfer; onSaved: (result: Record<string, unknown>) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const occurrence = useBookingRecord<{ items: AdminOccurrence[]; next_cursor: string | null }>(`occurrences?occurrence_id=${proposal.customer.source.occurrence_id}`);
  const source = occurrence.data?.items.find(row => row.occurrence.occurrence_id === proposal.customer.source.occurrence_id);
  const sources = usePaymentList<TransferCarryoverOption>(`enrollment-transfer-proposals/${proposal.proposal_id}/sources`);
  const reserved = source?.roster.find(row => row.enrollment_id === proposal.customer.source.enrollment_id)?.funding.reserved_credit_quanta ?? 0;
  return <section className={styles.private}><h3>{copy.adminReview}</h3><p>{copy.adminDescription}</p><ReadState pending={!source} {...occurrence} /><PaymentReadState pending={!sources.items} {...sources} />{source && (!source.fee_agreement || !proposal.destination_fee_snapshot) && <p className={styles.notice}>{copy.feePrerequisite} <Link className={styles.link} href={`/admin/schedule?occurrence=${proposal.customer.requested_destination.occurrence_id}`}>{copy.openDestinationSchedule}</Link></p>}{source?.fee_agreement && <><p>{copy.originalFee}: {money(source.fee_agreement.fee_minor, 'EGP', uiLanguage)}</p><IdentityForm action={`enrollment-transfer-proposals/${proposal.proposal_id}/review`} submitLabel={copy.saveReview} successMessage={copy.reviewSaved} resettable={false} disabled={!sources.items || Boolean(sources.error) || !proposal.destination_fee_snapshot} onSaved={onSaved} payload={form => {
    const amount = amountField(form, 'source_fee', { allowZero: true }); if (amount > source.fee_agreement!.fee_minor) throw new Error('AMOUNT_OUT_OF_RANGE');
    const allocations = (sources.items || []).map(row => ({ allocation_id: row.allocation_id, amount_minor: amountField(form, `carry-${row.allocation_id}`, { allowZero: true }) })).filter(row => row.amount_minor > 0);
    for (const allocation of allocations) if (allocation.amount_minor > sources.items!.find(row => row.allocation_id === allocation.allocation_id)!.releasable_minor) throw new Error('AMOUNT_OUT_OF_RANGE');
    const released = reserved ? creditField(form, 'release') : 0; if (released > reserved) throw new Error('AMOUNT_OUT_OF_RANGE');
    return { source_tutor_fee_minor: amount, carryover_allocations: allocations, source_package_disposition: reserved ? { released_credit_quanta: released, extinguished_credit_quanta: reserved - released } : null, reason: String(form.get('reason')).trim(), expected_version: proposal.version };
  }}><AmountField name="source_fee" label={copy.sourceFee} value={source.fee_agreement.fee_minor} max={source.fee_agreement.fee_minor} allowZero /><p>{copy.feeExplanation}</p><h4>{copy.sources}</h4>{sources.items?.length === 0 && <p>{copy.noSources}</p>}{sources.items?.map(row => <div key={row.allocation_id} className={styles.section}><p>{row.payer_masked_label} · {row.source_reference}</p><p>{copy.releasable}: {money(row.releasable_minor, 'EGP', uiLanguage)}</p><AmountField name={`carry-${row.allocation_id}`} label={`${copy.carryAmount} — ${row.source_reference}`} value={row.selected_carryover_minor} max={row.releasable_minor} allowZero /></div>)}{reserved > 0 && <fieldset className={styles.section}><legend>{copy.sourceCredits}: {credits(reserved, uiLanguage)}</legend><p>{copy.creditExplanation}</p><CreditField name="release" label={copy.creditsReturn} max={reserved} allowZero /></fieldset>}<TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></>}</section>;
}
