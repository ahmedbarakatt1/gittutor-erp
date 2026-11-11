'use client';

import { useId, useState } from 'react';
import type { AdminOccurrence, OperationProposal, GroupAmendment } from '@/modules/booking/queries';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';
import { bookingCopy } from '@/locales/booking';
import { packageCopy } from '@/locales/packages';
import { IdentityForm, TextField } from '../identity-form';
import { CustomerTerms } from './customer-proposals';
import { CairoInput, Check, ReadState, Select, SessionTime, instantField, money, moneyField, useBookingRecord } from './shared';
import { AmountField } from '../payments/shared';
import { PackageProposalReview } from '../packages/package-proposals';
import { CreditField, creditField, credits } from '../packages/shared';
import styles from './booking.module.css';
import formStyles from '../auth.module.css';

type TutorProposalTerms = Extract<OperationProposal, { view: 'tutor' }>['terms'];

function TeachingTerms({ terms }: { terms: TutorProposalTerms }) {
  return <section className={styles.private}><h3>{copy.privateTerms}</h3><p>{copy.privateNotice}</p><dl className={styles.facts}><div><dt>{bookingCopy.newTime}</dt><dd><SessionTime start={terms.start_at} end={terms.end_at} /></dd></div><div><dt>{terms.fee_agreement_state === 'reviewed_cancellation' ? copy.cancellationCompensation : copy.approvedFee}</dt><dd>{terms.fee_minor === null ? copy.feePending : money(terms.fee_minor)}</dd></div><div><dt>{copy.duration}</dt><dd>{terms.duration_minutes} min</dd></div></dl>{terms.fee_agreement_state === 'pending_approval' && <p>{copy.pendingFee}</p>}</section>;
}

export function StaffProposal({ id: initialId, kind, view, names = {}, onSaved }: { id: string; kind: 'operation' | 'amendment'; view: 'tutor' | 'admin'; names?: Record<string, string>; onSaved?: () => void }) {
  const [id, setId] = useState(initialId);
  const decisionId = useId();
  const route = kind === 'amendment' ? 'amendments' : 'operation-proposals'; const record = useBookingRecord<OperationProposal | GroupAmendment>(`${route}/${id}?view=${view}`);
  if (record.data?.kind === 'package_coverage' || record.data?.kind === 'package_conversion') return view === 'admin' ? <details className={styles.detail} data-proposal-id={id}><summary>{packageCopy.reviewProposal} · {record.data.kind === 'package_coverage' ? packageCopy.coverageTitle : packageCopy.conversion} · {packageCopy.states[record.data.state]}</summary><PackageProposalReview id={id} learnerId={record.data.terms.learner_id} view="admin" onSaved={saved} embedded /></details> : null;
  const proposal = record.data?.view === view ? record.data : undefined;
  function saved() { record.reload(); onSaved?.(); }
  return <details className={styles.detail} data-proposal-id={id}><summary>{copy.review}</summary><ReadState pending={!proposal} {...record} />{proposal && <div key={`${id}-${proposal.version}-${proposal.accepted_at}`}><p>{bookingCopy.states[proposal.state] || proposal.state}</p>{proposal.superseded_by_proposal_id && <p><button type="button" className={formStyles.signout} onClick={() => setId(proposal.superseded_by_proposal_id!)}>{bookingCopy.reviewReplacement}</button></p>}{proposal.replaces_proposal_id && <p>{bookingCopy.replacementNotice}</p>}{proposal.view === 'tutor' && <><TeachingTerms terms={proposal.terms} />{proposal.accepted_at ? <p className={formStyles.saved}>{copy.acceptedSaved}</p> : ['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`${route}/${id}/accept`} submitLabel={copy.accept} successMessage={copy.acceptedSaved} disabled={!proposal.can_accept} resettable={false} onSaved={saved} payload={() => ({ terms_hash: proposal.terms_hash, expected_version: proposal.version })}><Check name="teaching_consent" label={copy.acceptConsent} /></IdentityForm>}{['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`${route}/${id}/decline`} submitLabel={bookingCopy.decline} successMessage={bookingCopy.declined} resettable={false} onSaved={saved} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: proposal.version })}><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm>}</>}
    {proposal.view === 'admin' && <>{proposal.terms.tutor && <TeachingTerms terms={proposal.terms.tutor} />}{proposal.kind === 'cancellation_remedy' && !proposal.superseded_by_proposal_id && ['proposed', 'accepted'].includes(proposal.state) && <CancellationReview proposal={proposal} onSaved={result => { setId(String(result.proposal_id)); onSaved?.(); }} />}<h3>{copy.required}</h3><ul>{proposal.required_acceptances.map(item => <li key={`${item.participant_type}-${item.participant_id}`}>{names[item.participant_id] || (item.participant_type === 'tutor' ? copy.tutor : copy.learner)} · {item.accepted_at ? copy.received : copy.awaiting}</li>)}</ul>{proposal.terms.customers.map(terms => <details className={styles.detail} key={terms.learner_id}><summary>{names[terms.learner_id] || copy.learner}</summary><CustomerTerms terms={terms} /></details>)}{kind === 'operation' && ['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`${route}/${id}/approve`} submitLabel={copy.approve} successMessage={copy.approvalSaved} resettable={false} onSaved={saved} payload={form => ({ terms_hash: proposal.terms_hash, decision: String(form.get('decision')), reason: String(form.get('reason')).trim(), expected_version: proposal.version })}><div className={formStyles.field}><label htmlFor={decisionId}>{copy.decision}</label><select id={decisionId} name="decision" required defaultValue="rejected"><option value="approved" disabled={proposal.required_acceptances.some(item => !item.accepted_at)}>{copy.approveOption}</option><option value="rejected">{copy.rejectOption}</option></select></div><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm>}
      {kind === 'amendment' && ['proposed', 'accepted', 'approved'].includes(proposal.state) && <div className={styles.notice}><p>{copy.commitPending}</p><IdentityForm action={`amendments/${id}/commit`} submitLabel={copy.commit} successMessage={copy.committed} resettable={false} disabled={proposal.required_acceptances.some(item => !item.accepted_at)} onSaved={saved} payload={() => ({ expected_version: proposal.version })}>{null}</IdentityForm></div>}
      {proposal.kind === 'cancellation_remedy' && proposal.state === 'approved' && <IdentityForm action={`${proposal.target_type === 'occurrence' ? 'occurrences' : 'enrollments'}/${proposal.target_id}/cancel`} submitLabel={copy.applyCancellation} successMessage={copy.cancelled} resettable={false} onSaved={saved} payload={form => ({ remedy_proposal_id: id, reason: String(form.get('reason')).trim(), expected_version: proposal.base_version })}><p>{copy.applyCancellationDescription}</p><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm>}
      {proposal.kind === 'reschedule' && proposal.state === 'approved' && proposal.target_type === 'occurrence' && proposal.terms.tutor && <IdentityForm action={`occurrences/${proposal.target_id}/reschedule`} submitLabel={copy.moveSubmit} successMessage={copy.moved} resettable={false} onSaved={saved} payload={form => ({ start_at: proposal.terms.tutor!.start_at, end_at: proposal.terms.tutor!.end_at, time_zone: 'Africa/Cairo', accepted_proposal_id: id, reason: String(form.get('reason')).trim(), expected_version: proposal.base_version })}><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm>}
    </>}
  </div>}</details>;
}

function CancellationReview({ proposal, onSaved }: { proposal: Extract<OperationProposal, { view: 'admin'; kind: 'reschedule' | 'cancellation_remedy' }>; onSaved: (result: Record<string, unknown>) => void }) {
  const occurrenceId = proposal.terms.tutor?.occurrence_id || proposal.terms.customers[0]?.old_occurrence_id;
  const current = useBookingRecord<{ items: AdminOccurrence[]; next_cursor: string | null }>(`occurrences?occurrence_id=${occurrenceId}`);
  const occurrence = current.data?.items.find(row => row.occurrence.occurrence_id === occurrenceId);
  const maximum = occurrence?.fee_agreement?.fee_minor ?? 0;
  const reserved = occurrence?.roster.filter(row => proposal.terms.customers.some(terms => terms.enrollment_id === row.enrollment_id) && (row.funding.reserved_credit_quanta ?? 0) > 0) ?? [];
  return <details className={styles.private}><summary>{copy.reviewCancellation}</summary><p>{copy.reviewCancellationDescription}</p><ReadState pending={!current.data} {...current} />{occurrence && <><p>{copy.cancellationMaximum}: <bdi>{money(maximum)}</bdi></p><IdentityForm action={`operation-proposals/${proposal.proposal_id}/revise-cancellation`} submitLabel={copy.saveCancellationReview} successMessage={copy.cancellationReviewed} resettable={false} onSaved={onSaved} payload={form => {
    const tutor_compensation_minor = moneyField(form, 'compensation');
    if (tutor_compensation_minor > maximum) throw new Error('AMOUNT_OUT_OF_RANGE');
    const package_dispositions = reserved.map(row => {
      const released_credit_quanta = creditField(form, `release_${row.enrollment_id}`);
      const extinguished_credit_quanta = row.funding.reserved_credit_quanta! - released_credit_quanta;
      if (extinguished_credit_quanta < 0) throw new Error('INVALID_CREDIT_QUANTITY');
      return { enrollment_id: row.enrollment_id, released_credit_quanta, extinguished_credit_quanta };
    });
    return { tutor_compensation_minor, ...(package_dispositions.length ? { package_dispositions } : {}), reason: String(form.get('reason')).trim(), expected_version: proposal.version };
  }}><AmountField name="compensation" label={copy.cancellationCompensation} max={maximum} allowZero />{reserved.length > 0 && <fieldset className={styles.section}><legend>{copy.cancellationPackageDisposition}</legend><p>{copy.cancellationPackageDescription}</p>{reserved.map(row => <div key={row.enrollment_id}><h4>{row.display_name}</h4><p>{copy.cancellationReservedCredits}: {credits(row.funding.reserved_credit_quanta!)}</p><CreditField name={`release_${row.enrollment_id}`} label={`${copy.cancellationCreditsToReturn} · ${row.display_name}`} max={row.funding.reserved_credit_quanta!} allowZero /></div>)}</fieldset>}<TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm></>}</details>;
}

export function CreateOperationProposal({ occurrence, view = 'admin', onSaved }: { occurrence: AdminOccurrence['occurrence']; view?: 'admin' | 'tutor'; onSaved?: () => void }) {
  const [kind, setKind] = useState('reschedule'); const [remedy, setRemedy] = useState('policy_default'); const [created, setCreated] = useState('');
  const duration = Date.parse(occurrence.end_at) - Date.parse(occurrence.start_at);
  return <details className={styles.section}><summary>{copy.newProposal}</summary><Select name="proposal_kind" label={copy.proposalKind} value={kind} onChange={value => { setKind(value); setCreated(''); }}><option value="reschedule">{copy.reschedule}</option>{view === 'admin' && <option value="cancellation_remedy">{copy.cancellation}</option>}</Select>
    <IdentityForm key={`${occurrence.occurrence_id}-${occurrence.version}-${kind}`} action="operation-proposals" submitLabel={copy.submitProposal} successMessage={copy.proposalSaved} resettable={false} onSaved={result => { setCreated(String(result.proposal_id)); onSaved?.(); }} payload={form => {
      const expires_at = instantField(form, 'expires_at');
      const requested_terms = kind === 'reschedule' ? { target_type: 'occurrence', start_at: instantField(form, 'start_at'), end_at: new Date(Date.parse(instantField(form, 'start_at')) + duration).toISOString(), time_zone: 'Africa/Cairo', expires_at } : { target_type: 'occurrence', remedy, expires_at };
      return { kind, target_id: occurrence.occurrence_id, expected_version: occurrence.version, requested_terms, reason: String(form.get('reason')).trim() };
    }}>{kind === 'reschedule' ? <><CairoInput name="start_at" label={copy.proposedStart} /><p>{copy.duration}: {duration / 60_000} min. {copy.durationNote}</p></> : <Select name="remedy" label={bookingCopy.remedy} value={remedy} onChange={setRemedy}>{Object.entries(bookingCopy.remedies).filter(([value]) => value !== 'none').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}<CairoInput name="expires_at" label={copy.expiry} /><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm>{created && <StaffProposal id={created} kind="operation" view={view} />}
  </details>;
}
