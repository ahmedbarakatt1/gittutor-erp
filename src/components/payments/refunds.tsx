'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { RefundSummary, RefundSource, RefundDestination, RefundAttempt, RefundReversal, RefundRemedy } from '@/modules/payments/queries';
import { paymentCopy as copy } from '@/locales/payments';
import { IdentityForm, TextField } from '../identity-form';
import { useHydrated } from '../use-hydrated';
import { Select, CairoInput, CairoTimestamp, instantField, money } from '../booking/shared';
import { AmountField, amountField, EvidenceSelect, PaymentReadState, State, usePaymentList, usePaymentRecord } from './shared';
import styles from './payments.module.css';
import formStyles from '../auth.module.css';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPaymentCopy },
};


export function Refunds({ admin = false }: { admin?: boolean }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [state, setState] = useState('');
  const records = usePaymentList<RefundSummary>(admin ? `admin/refunds${state ? `?state=${state}` : ''}` : 'me/refunds');
  return <><section className={styles.section}><h2>{copy.refundsNav}</h2>{admin && <Select name="state" label={copy.state} value={state} onChange={setState}><option value="">{copy.all}</option>{['requested', 'approved', 'pending', 'settled', 'partially_reversed', 'reversed', 'failed', 'unknown', 'cancelled'].map(value => <option key={value} value={value}>{copy.states[value]}</option>)}</Select>}<PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p className={styles.empty}>{copy.none}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.refund_id}><div className={styles.row}><strong><bdi>{money(row.amount_minor, 'EGP', uiLanguage)}</bdi></strong><State value={row.state} /></div><p><CairoTimestamp value={row.requested_at} /></p>{row.destination && <p>{copy.channelNames[row.destination.channel]} · {row.destination.masked_identifier}</p>}<Link className={styles.link} href={`${admin ? '/admin' : '/learn'}/refunds/${row.refund_id}`}>{copy.openRefund}</Link></li>)}</ul></section><RequestRefund admin={admin} onSaved={records.reload} /></>;
}
function RequestRefund({ admin, onSaved }: { admin: boolean; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const sources = usePaymentList<RefundSource>(`refund-sources?view=${admin ? 'admin' : 'customer'}`), [selected, setSelected] = useState(''), [created, setCreated] = useState('');
  const key = (row: RefundSource) => `${row.source_type}:${row.source_id}:${row.view === 'admin' ? row.payer.account_id : 'self'}`;
  const choices = sources.items?.filter(row => row.view === (admin ? 'admin' : 'customer'));
  const source = choices?.find(row => key(row) === selected);
  return <section className={styles.section}><h2>{copy.requestRefund}</h2><Select name="source" label={copy.refundSource} value={selected} onChange={value => { setSelected(value); setCreated(''); }}><option value="">{copy.refundSources}</option>{choices?.map(row => <option key={key(row)} value={key(row)}>{row.title} · {money(row.refundable_minor, 'EGP', uiLanguage)}{row.view === 'admin' ? ` · ${row.payer.display_name} · ${row.payer.masked_contact}` : ''}</option>)}</Select><PaymentReadState pending={!sources.items} {...sources} />{sources.items?.length === 0 && <p>{copy.noRefundSources}</p>}{source && <div key={selected}><p>{copy.refundable}: <bdi>{money(source.refundable_minor, 'EGP', uiLanguage)}</bdi></p>{source.requires_remedy && <p className={styles.notice}>{copy.requiresRemedy}</p>}<IdentityForm action="refunds" submitLabel={copy.requestRefund} successMessage={copy.requestedRefund} resettable={false} payload={form => ({ source_type: source.source_type, source_id: source.source_id, payer_account_id: source.view === 'admin' ? source.payer.account_id : null, amount_minor: amountField(form, 'amount', { max: source.refundable_minor }), reason: String(form.get('reason')) })} onSaved={result => { setCreated(String(result.refund_id)); onSaved(); }}><AmountField name="amount" label={copy.refundAmount} max={source.refundable_minor} /><TextField name="reason" label={copy.refundReason} maxLength={2000} /></IdentityForm>{created && <p><Link className={styles.link} href={`${admin ? '/admin' : '/learn'}/refunds/${created}`}>{copy.openRefund}</Link></p>}</div>}</section>;
}
export function RefundDetail({ id, admin = false }: { id: string; admin?: boolean }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const record = usePaymentRecord<RefundSummary>(`refunds/${id}`), refund = record.data;
  return <><PaymentReadState pending={!refund} {...record} />{refund && <><section className={styles.summary}><h2>{copy.refundDetails}</h2><State value={refund.state} /><dl className={styles.facts}>{[[copy.refundAmount, refund.amount_minor], [copy.reserved, refund.reserved_minor], [copy.refunded, refund.settled_minor], [copy.returned, refund.returned_minor]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><bdi>{money(value as number, 'EGP', uiLanguage)}</bdi></dd></div>)}</dl>{refund.destination && <p>{copy.destination}: {copy.channelNames[refund.destination.channel]} · {refund.destination.masked_identifier}</p>}<p>{copy.nextAction}: {refund.next_action}</p>{refund.state === 'unknown' && <p className={styles.notice}>{copy.unknownHold}</p>}</section>{refund.state === 'requested' && refund.can_propose_destination && <DestinationForm key={`destination-${refund.version}`} refund={refund} onSaved={record.reload} />}<DestinationList key={`destinations-${refund.version}`} refund={refund} admin={admin} onSaved={record.reload} />{admin && <RefundApproval key={`approval-${refund.version}`} refund={refund} onSaved={record.reload} />}<RefundAttempts key={`attempts-${refund.version}`} refund={refund} admin={admin} onSaved={record.reload} /><RefundReturns id={id} /></>}</>;
}
function DestinationForm({ refund, onSaved }: { refund: RefundSummary; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [channel, setChannel] = useState('instapay'), [file, setFile] = useState('');
  return <section className={styles.section}><h2>{copy.proposeDestination}</h2><p className={styles.intro}>{copy.destinationPrivacy}</p><IdentityForm action={`refunds/${refund.refund_id}/destination`} submitLabel={copy.proposeDestination} successMessage={copy.destinationProposed} clearFieldsOnSuccess resettable={false} disabled={!file} payload={form => ({ channel, identifier: String(form.get('identifier')), payee_name: String(form.get('payee')), source_evidence_file_id: file, expected_version: refund.version })} onSaved={onSaved}><Select name="channel" label={copy.channel} value={channel} onChange={setChannel}>{Object.entries(copy.channelNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><TextField name="identifier" label={copy.destinationIdentifier} maxLength={200} /><TextField name="payee" label={copy.payee} maxLength={200} /><EvidenceSelect action="propose_refund_destination" targetId={refund.refund_id} value={file} onChange={setFile} label={copy.destinationEvidence} /></IdentityForm></section>;
}
function DestinationList({ refund, admin, onSaved }: { refund: RefundSummary; admin: boolean; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<RefundDestination>(`refunds/${refund.refund_id}/destinations`);
  return <section className={styles.section}><h2>{copy.destinations}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.noDestinations}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.destination_id}><h3>{copy.channelNames[row.channel]} · {row.masked_identifier}</h3><p>{row.payee_name}</p><State value={row.verification_status} />{admin && row.verification_status === 'unverified' && <DestinationVerification key={row.version} destination={row} onSaved={() => { records.reload(); onSaved(); }} />}</li>)}</ul></section>;
}
function DestinationVerification({ destination, onSaved }: { destination: RefundDestination; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [file, setFile] = useState(''), [decision, setDecision] = useState('verified');
  return <IdentityForm action={`refund-destinations/${destination.destination_id}/verify`} submitLabel={copy.verifyDestination} successMessage={copy.destinationVerified} disabled={!file} resettable={false} payload={form => ({ evidence_file_id: file, decision, reason: String(form.get('reason')), expected_version: destination.version })} onSaved={onSaved}><Select name="decision" label={copy.decision} value={decision} onChange={setDecision}><option value="verified">{copy.verified}</option><option value="rejected">{copy.rejected}</option></Select><EvidenceSelect action="verify_refund_destination" targetId={destination.destination_id} value={file} onChange={setFile} label={copy.destinationEvidence} /><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>;
}
function RefundApproval({ refund, onSaved }: { refund: RefundSummary; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const destinations = usePaymentList<RefundDestination>(`refunds/${refund.refund_id}/destinations`), remedies = usePaymentList<RefundRemedy>(`refunds/${refund.refund_id}/remedies`), [destination, setDestination] = useState(''), [remedy, setRemedy] = useState('');
  if (refund.state !== 'requested') return null;
  return <section className={styles.section}><h2>{copy.approveRefund}</h2><IdentityForm action={`refunds/${refund.refund_id}/approve`} submitLabel={copy.approveRefund} successMessage={copy.refundApproved} disabled={!destination || (refund.requires_remedy && !remedy)} resettable={false} payload={form => ({ remedy_id: remedy || null, destination_version_id: destination, amount_minor: amountField(form, 'amount', { max: refund.amount_minor }), reason: String(form.get('reason')), expected_version: refund.version })} onSaved={onSaved}><Select name="destination" label={copy.verifiedDestination} value={destination} onChange={setDestination}><option value="">{copy.choose}</option>{destinations.items?.filter(row => row.verification_status === 'verified' && row.destination_version_id).map(row => <option key={row.destination_version_id} value={row.destination_version_id!}>{row.payee_name} · {copy.channelNames[row.channel]} · {row.masked_identifier}</option>)}</Select><PaymentReadState pending={!destinations.items} {...destinations} /><Select name="remedy" label={copy.remedy} value={remedy} onChange={setRemedy} required={refund.requires_remedy}><option value="">{refund.requires_remedy ? copy.choose : copy.noRemedy}</option>{remedies.items?.map(row => <option key={row.remedy_id} value={row.remedy_id}>{row.title} · {money(row.remaining_refundable_minor, 'EGP', uiLanguage)}</option>)}</Select><PaymentReadState pending={!remedies.items} {...remedies} /><AmountField name="amount" label={copy.refundAmount} value={refund.amount_minor} max={refund.amount_minor} /><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></section>;
}
function RefundAttempts({ refund, admin, onSaved }: { refund: RefundSummary; admin: boolean; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<RefundAttempt>(`refunds/${refund.refund_id}/attempts`), [selected, setSelected] = useState(''); const attempt = records.items?.find(row => row.attempt_id === selected);
  const destinations = usePaymentList<RefundDestination>(admin ? `refunds/${refund.refund_id}/destinations` : null);
  const pinned = destinations.items?.find(row => row.destination_version_id === refund.destination?.destination_version_id);
  useEffect(() => { if (admin && refund.destination && destinations.items && !pinned && destinations.cursor && !destinations.loadingMore && !destinations.error) void destinations.loadMore(); }, [admin, refund.destination, destinations, pinned]);
  return <section className={styles.section}><h2>{copy.attempts}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.noAttempts}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.attempt_id}><div className={styles.row}><strong>{row.external_reference}</strong><State value={row.state} /></div><CairoTimestamp value={row.recorded_at} />{row.state === 'unknown' && <p className={styles.notice}>{copy.unknownHold}</p>}</li>)}</ul>{admin && <>{['approved', 'failed'].includes(refund.state) && <IdentityForm action={`refunds/${refund.refund_id}/attempts`} submitLabel={copy.recordAttempt} successMessage={copy.attemptRecorded} resettable={false} payload={form => ({ external_reference: String(form.get('reference')), expected_version: refund.version })} onSaved={onSaved}><TextField name="reference" label={copy.outgoingReference} maxLength={200} /></IdentityForm>}<Select name="attempt" label={copy.chooseAttempt} value={selected} onChange={setSelected}><option value="">{copy.choose}</option>{records.items?.map(row => <option key={row.attempt_id} value={row.attempt_id}>{row.external_reference} · {copy.states[row.state]}</option>)}</Select>{attempt && ['pending', 'unknown'].includes(attempt.state) && <>{pinned && <RevealDestination key={`reveal-${attempt.attempt_id}`} destination={pinned} attempt={attempt} />}<ReconcileRefund key={attempt.attempt_id} refund={refund} attempt={attempt} onSaved={onSaved} /></>}{attempt?.state === 'settled' && <RefundReturnForm key={attempt.attempt_id} refund={refund} attempt={attempt} onSaved={onSaved} />}</>}</section>;
}
function RevealDestination({ destination, attempt }: { destination: RefundDestination; attempt: RefundAttempt }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const hydrated = useHydrated(), [identifier, setIdentifier] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!hydrated || pending) return; const form = event.currentTarget; if (!form.reportValidity()) return; const reason = String(new FormData(form).get('reason')); setPending(true); setError(''); setIdentifier('');
    try { const response = await fetch(`/api/v1/refund-destinations/${destination.destination_id}/reveal`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refund_attempt_id: attempt.attempt_id, reason }) }); const body = await response.json(); if (!response.ok || typeof body.data?.identifier !== 'string') throw new Error('REVEAL_FAILED'); setIdentifier(body.data.identifier); form.reset(); } catch { setError(copy.failed); } finally { setPending(false); }
  }
  return <details className={styles.disclosure} onToggle={event => { if (!event.currentTarget.open) setIdentifier(''); }}><summary>{copy.revealDestination}</summary><p>{copy.revealNotice}</p><p>{destination.payee_name} · {destination.masked_identifier}</p><form method="post" className={formStyles.form} onSubmit={reveal} aria-label={copy.revealDestination}><fieldset className={formStyles.formFields} disabled={!hydrated || pending}><TextField name="reason" label={copy.revealReason} maxLength={2000} /></fieldset><button type="submit" className={formStyles.primary} disabled={!hydrated || pending}>{copy.revealDestination}</button></form>{error && <p role="alert" className={formStyles.error}>{error}</p>}{identifier && <div><p>{copy.revealedDestination}: <output><bdi dir="ltr">{identifier}</bdi></output></p><button type="button" className={formStyles.signout} onClick={() => setIdentifier('')}>{copy.hideDestination}</button></div>}</details>;
}
function ReconcileRefund({ refund, attempt, onSaved }: { refund: RefundSummary; attempt: RefundAttempt; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [outcome, setOutcome] = useState('unknown'), [file, setFile] = useState('');
  return <IdentityForm action={`refunds/${refund.refund_id}/reconcile`} submitLabel={copy.reconcile} successMessage={copy.reconciled} disabled={!file} resettable={false} payload={form => ({ attempt_id: attempt.attempt_id, outcome, evidence_file_id: file, external_reference: String(form.get('reference')), settled_at: outcome === 'settled' ? instantField(form, 'settled_at') : null, expected_version: refund.version })} onSaved={onSaved}><Select name="outcome" label={copy.outcomeLabel} value={outcome} onChange={setOutcome}><option value="unknown">{copy.outcomeUnknown}</option><option value="settled">{copy.outcomeSettled}</option><option value="failed">{copy.outcomeFailed}</option></Select><TextField name="reference" label={copy.outgoingReference} defaultValue={attempt.external_reference} maxLength={200} />{outcome === 'settled' && <CairoInput name="settled_at" label={copy.settledAt} />}<EvidenceSelect action="reconcile_refund" targetId={attempt.attempt_id} value={file} onChange={setFile} /></IdentityForm>;
}
function RefundReturnForm({ refund, attempt, onSaved }: { refund: RefundSummary; attempt: RefundAttempt; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [file, setFile] = useState('');
  return <details className={styles.disclosure}><summary>{copy.reverseRefund}</summary><IdentityForm action={`refunds/${refund.refund_id}/reversals`} submitLabel={copy.reverseRefund} successMessage={copy.refundReversed} disabled={!file} payload={form => ({ attempt_id: attempt.attempt_id, external_reversal_id: String(form.get('reference')), amount_minor: amountField(form, 'amount'), evidence_file_id: file, effective_at: instantField(form, 'effective_at'), expected_version: refund.version })} onSaved={onSaved}><TextField name="reference" label={copy.reversalReference} maxLength={200} /><AmountField name="amount" label={copy.returnedAmount} /><CairoInput name="effective_at" label={copy.effectiveAt} /><EvidenceSelect action="record_refund_reversal" targetId={attempt.attempt_id} value={file} onChange={setFile} /></IdentityForm></details>;
}
function RefundReturns({ id }: { id: string }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<RefundReversal>(`refunds/${id}/reversals`);
  return <section className={styles.section}><h2>{copy.reversals}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.none}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.refund_reversal_id}><p><bdi>{money(row.amount_minor, 'EGP', uiLanguage)}</bdi> · <CairoTimestamp value={row.effective_at} /></p><p className={styles.reference}>{copy.reference}: {row.refund_reversal_id}</p></li>)}</ul></section>;
}
