'use client';

import { useId, useState } from 'react';
import type { CustomerEnrollment, PublicOccurrence, OperationProposal, GroupAmendment, CustomerProposalTerms } from '@/modules/booking/queries';
import { bookingCopy as copy } from '@/locales/booking';
import { IdentityForm, TextField } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { OfferTerms } from '../catalog/offer-terms';
import { CairoInput, CairoTimestamp, Check, ReadState, Select, SessionTime, cairoDate, cairoTime, instantField, money, useBookingRecord } from './shared';
import styles from './booking.module.css';
import formStyles from '../auth.module.css';

export function CustomerTerms({ terms }: { terms: CustomerProposalTerms }) {
  const headingId = useId();
  return <><dl className={styles.facts}><div><dt>{copy.oldTime}</dt><dd><SessionTime start={terms.old_start_at} end={terms.old_end_at} /></dd></div><div><dt>{copy.newTime}</dt><dd><SessionTime start={terms.start_at} end={terms.end_at} /></dd></div><div><dt>{copy.oldTuition}</dt><dd>{money(terms.old_customer_price_minor)}</dd></div><div><dt>{copy.newTuition}</dt><dd>{money(terms.customer_price_minor)}</dd></div><div><dt>{copy.adjustment}</dt><dd>{money(terms.customer_adjustment_minor)}</dd></div>{terms.remedy !== 'none' && <div><dt>{copy.remedy}</dt><dd>{copy.remedies[terms.remedy]} · {terms.remedy_amount_minor === null ? copy.unknownMoney : money(terms.remedy_amount_minor)}</dd></div>}</dl><OfferTerms terms={terms.customer_policy} policyId={terms.policy_version_id} headingId={headingId} /></>;
}

export function CustomerProposal({ id, learnerId, kind = 'operation' }: { id: string; learnerId: string; kind?: 'operation' | 'amendment' }) {
  const route = kind === 'amendment' ? 'amendments' : 'operation-proposals';
  const record = useBookingRecord<OperationProposal | GroupAmendment>(`${route}/${id}?view=customer&learner_id=${encodeURIComponent(learnerId)}`);
  const proposal = record.data?.view === 'customer' ? record.data : undefined;
  const financialPending = proposal && proposal.terms.remedy !== 'none' && proposal.terms.remedy_amount_minor === null;
  return <details className={styles.detail}><summary>{copy.reviewChange}</summary><ReadState pending={!proposal} {...record} />{proposal && <div key={`${id}-${proposal.version}-${proposal.accepted_at}`}><h3>{copy.proposal}</h3><p>{copy.proposalDescription}</p><p>{copy.states[proposal.state] || proposal.state}</p><p>{copy.proposalExpires}: <CairoTimestamp value={proposal.expires_at} /></p><CustomerTerms terms={proposal.terms} /><p>{copy.pendingApproval}</p>{financialPending && <p className={styles.notice}>{copy.financialPending}</p>}
      {proposal.accepted_at ? <p className={formStyles.saved}>{copy.proposalAccepted}</p> : ['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`${route}/${id}/accept`} payload={() => ({ terms_hash: proposal.terms_hash, expected_version: proposal.version })} submitLabel={copy.proposalAccept} successMessage={copy.proposalAccepted} disabled={!proposal.can_accept} resettable={false} onSaved={record.reload}><Check name="proposal_consent" label={copy.proposalConsent} /></IdentityForm>}
      {['proposed', 'accepted'].includes(proposal.state) && <IdentityForm action={`${route}/${id}/decline`} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: proposal.version })} submitLabel={copy.decline} successMessage={copy.declined} resettable={false} onSaved={record.reload}><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>}
    </div>}</details>;
}

export function CustomerChangeRequest({ enrollment }: { enrollment: CustomerEnrollment }) {
  const [kind, setKind] = useState('reschedule'); const [destination, setDestination] = useState(''); const [remedy, setRemedy] = useState('policy_default'); const [proposalId, setProposalId] = useState('');
  const choices = usePagedRecords<PublicOccurrence>(`booking/occurrences?offer_id=${enrollment.occurrence.offer_id}`);
  if (!['held', 'confirmed'].includes(enrollment.state)) return null;
  return <details className={styles.section}><summary>{copy.requestChange}</summary><Select name="change_kind" label={copy.changeKind} value={kind} onChange={value => { setKind(value); setProposalId(''); }}><option value="reschedule">{copy.reschedule}</option><option value="cancellation_remedy">{copy.cancellation}</option></Select><p>{copy.pendingApproval}</p>{kind === 'reschedule' && <ReadState pending={choices.items === null} {...choices} />}
    <IdentityForm key={`${kind}-${enrollment.version}`} action="operation-proposals" submitLabel={copy.submitRequest} successMessage={copy.requested} resettable={false} onSaved={result => setProposalId(String(result.proposal_id))} payload={form => ({ kind, target_id: enrollment.enrollment_id, expected_version: enrollment.version, requested_terms: kind === 'reschedule' ? { target_type: 'enrollment', destination_occurrence_id: destination, expires_at: instantField(form, 'expires_at') } : { target_type: 'enrollment', remedy, expires_at: instantField(form, 'expires_at') }, reason: String(form.get('reason')).trim() })}>
      {kind === 'reschedule' ? <Select name="destination" label={copy.destination} value={destination} onChange={setDestination}><option value="">{copy.chooseDestination}</option>{choices.items?.filter(item => item.occurrence_id !== enrollment.occurrence.occurrence_id && item.available_seats > 0).map(item => <option key={item.occurrence_id} value={item.occurrence_id}>{cairoDate(item.start_at)} {cairoTime(item.start_at)} · {item.tutor.display_name} · {money(item.customer_price_minor)}</option>)}</Select> : <Select name="remedy" label={copy.remedy} value={remedy} onChange={setRemedy}>{Object.entries(copy.remedies).filter(([value]) => value !== 'none').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}
      <CairoInput name="expires_at" label={copy.requestExpiry} /><TextField name="reason" label={copy.reason} maxLength={2000} />
    </IdentityForm>{proposalId && <CustomerProposal id={proposalId} learnerId={enrollment.learner.learner_id} />}
  </details>;
}
