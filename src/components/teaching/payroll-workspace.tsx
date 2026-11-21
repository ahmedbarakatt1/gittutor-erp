'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import type { TutorStatement, Earning, PayoutDestination, PayoutAttempt, PayoutTutor } from '@/modules/tutor_pay/payroll';
import type { FinanceCashAccount } from '@/modules/analytics/finance';
import type {TutorAward} from '@/modules/tutor_pay/payroll';
import { payrollCopy as copy } from '@/locales/payroll';
import { IdentityForm, TextField } from '../identity-form';
import { CairoInput, CairoTimestamp, instantField, money, Select } from '../booking/shared';
import { AmountField, amountField, EvidenceSelect, PaymentReadState, usePaymentList, usePaymentRecord } from '../payments/shared';
import { useHydrated } from '../use-hydrated';
import styles from '../files/files.module.css';
import formStyles from '../auth.module.css';
import { payrollCopy as arabicPayrollCopy } from '@/locales/ar-transaction/payroll';
import { useSiteLanguage } from '@/components/site-language';
import { transactionLabel } from '@/locales/ar-transaction/labels';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPayrollCopy },
};


export function PayrollWorkspace({ admin = false }: { admin?: boolean }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const tutors = usePaymentList<PayoutTutor>(admin ? 'payout-tutors' : null), [selected, setSelected] = useState(''), current = tutors.items?.find(row => row.tutor_id === selected);
  return <>{admin && <><Select name="pay_tutor" label={copy.tutor} value={selected} onChange={setSelected}><option value="">{copy.choose}</option>{tutors.items?.map(row => <option key={row.tutor_id} value={row.tutor_id}>{row.display_name}</option>)}</Select><PaymentReadState pending={!tutors.items} {...tutors} /></>}{(!admin || current) && <PayDetails key={current?.tutor_id || 'self'} tutor={current} onMethodsSaved={tutors.reload} />}</>;
}
function PayDetails({ tutor, onMethodsSaved }: { tutor?: PayoutTutor; onMethodsSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const query = tutor ? `?tutor_id=${tutor.tutor_id}` : '', summary = usePaymentRecord<TutorStatement>(`tutor/statement${query}`), earnings = usePaymentList<Earning>(`tutor/earnings${query}`), destinations = usePaymentList<PayoutDestination>(`tutor/payout-destinations${query}`), attempts = usePaymentList<PayoutAttempt>(`payouts${query}`);
  const reload = () => { summary.reload(); earnings.reload(); destinations.reload(); attempts.reload(); };
  return <><section className={styles.section}><h2>{copy.statement}</h2><p>{copy.private}</p><PaymentReadState pending={!summary.data} {...summary} />{summary.data && <><p>{copy.asOf}: <CairoTimestamp value={summary.data.as_of} /></p><dl className={formStyles.metricGrid}>{(['earned_minor', 'settled_minor', 'owed_minor', 'reserved_minor', 'available_minor', 'recovery_minor'] as const).map(key => <div key={key}><dt>{copy.amounts[key]}</dt><dd><strong>{money(summary.data![key], 'EGP', uiLanguage)}</strong></dd></div>)}</dl></>}</section>
    {tutor && <details className={styles.section}><summary>{copy.methods}</summary><IdentityForm key={tutor.version} action={`tutors/${tutor.tutor_id}/payout-methods`} submitLabel={copy.saveMethods} successMessage={copy.methodsSaved} onSaved={() => { onMethodsSaved(); reload(); }} resettable={false} payload={form => ({ channels: form.getAll('channel'), expected_version: tutor.version })}>{(['instapay', 'vodafone_cash'] as const).map(channel => <label key={channel} className={styles.notice}><input type="checkbox" name="channel" value={channel} defaultChecked={tutor.enabled_channels.includes(channel)} />{copy[channel]}</label>)}</IdentityForm></details>}
    <section className={styles.section}><h2>{copy.earnings}</h2><PaymentReadState pending={!earnings.items} {...earnings} />{earnings.items?.length === 0 && <p>{copy.noRecords}</p>}<ul className={`${styles.list} ${formStyles.recordGrid}`}>{earnings.items?.map(row => <li key={row.earning_id}><p>{row.source_type.replaceAll('_', ' ')}</p><dl className={formStyles.metricGrid}><div><dt>{copy.base}</dt><dd>{money(row.amount_minor, 'EGP', uiLanguage)}</dd></div><div><dt>{copy.adjustments}</dt><dd>{money(row.adjustment_minor, 'EGP', uiLanguage)}</dd></div><div><dt>{copy.net}</dt><dd>{money(row.net_minor, 'EGP', uiLanguage)}</dd></div><div><dt>{copy.amounts.owed_minor}</dt><dd>{money(row.owed_minor, 'EGP', uiLanguage)}</dd></div></dl><p>{copy.effective}: <CairoTimestamp value={row.effective_at} /></p><p>{copy.recorded}: <CairoTimestamp value={row.posted_at} /></p><Link href={`/${tutor ? 'admin' : 'tutor'}/schedule?occurrence=${row.occurrence_id}`}>{copy.viewSession}</Link></li>)}</ul></section>
    <section className={styles.section}><h2>{copy.destinations}</h2><p>{copy.destinationIntro}</p>{!tutor && <SubmitDestination onSaved={destinations.reload} />}<PaymentReadState pending={!destinations.items} {...destinations} /><ul className={`${styles.list} ${formStyles.recordGrid}`}>{destinations.items?.map(row => <li key={`${row.destination_id}-${row.version}`}><h3>{copy[row.channel]} · <bdi>{row.masked_identifier}</bdi></h3><p>{row.payee_name} · {copy.states[row.verification_status]}</p>{tutor && row.verification_status === 'unverified' && <VerifyDestination destination={row} onSaved={destinations.reload} />}</li>)}</ul></section>
    <SourceAwards tutorId={tutor?.tutor_id} onSaved={reload}/>
    {tutor && <AuthorizePayout tutor={tutor} earnings={earnings.items || []} destinations={destinations.items || []} onSaved={reload} />}
    <section className={styles.section}><h2>{copy.attempts}</h2><PaymentReadState pending={!attempts.items} {...attempts} />{attempts.items?.length === 0 && <p>{copy.noRecords}</p>}<ul className={`${styles.list} ${formStyles.recordGrid}`}>{attempts.items?.map(row => <li key={`${row.payout_attempt_id}-${row.version}`}><h3>{money(row.amount_minor, 'EGP', uiLanguage)} · {copy.states[row.state]}</h3><p>{copy[row.channel]} · <bdi>{row.masked_identifier}</bdi></p><p><CairoTimestamp value={row.created_at} /></p>{row.settled_at && <p>{copy.settledAt}: <CairoTimestamp value={row.settled_at} /></p>}{row.returned_minor > 0 && <p>{copy.returned}: {money(row.returned_minor, 'EGP', uiLanguage)}</p>}{row.state === 'unknown' && <p className={styles.notice}>{copy.unknown}</p>}{tutor && <PayoutActions attempt={row} destinations={destinations.items || []} onSaved={reload} />}</li>)}</ul></section>
  </>;
}
function SourceAwards({tutorId,onSaved}:{tutorId?:string;onSaved:()=>void}){
  const uiLanguage = useSiteLanguage();
const awards=usePaymentList<TutorAward>(`tutor/awards${tutorId?`?tutor_id=${tutorId}`:''}`);return <section className={styles.section}><h2>{transactionLabel(uiLanguage, "Cancellation and reassignment awards")}</h2><p>{transactionLabel(uiLanguage, "Amounts come from the accepted compensation decision. Posting an award recognizes the obligation once.")}</p><PaymentReadState pending={!awards.items} {...awards}/><ul className={`${styles.list} ${formStyles.recordGrid}`}>{awards.items?.map(a=><li key={a.award_id}><p>{a.source_type.replaceAll('_',' ')} · {money(a.amount_minor, 'EGP', uiLanguage)} · {a.earning_id?transactionLabel(uiLanguage, "Posted"):transactionLabel(uiLanguage, "Awaiting posting")}</p>{a.can_post&&<IdentityForm action={`occurrences/${a.occurrence_id}/${a.source_type==='cancellation_award'?'cancellation-award':'reassignment-award'}`} payload={f=>({...a.source_type==='cancellation_award'?{cancellation_decision_id:a.cancellation_decision_id}:{reassignment_id:a.reassignment_id},amount_minor:a.amount_minor,reason:String(f.get('reason')),expected_version:a.version})} submitLabel={transactionLabel(uiLanguage, "Post accepted award")} successMessage={transactionLabel(uiLanguage, "Award posted.")} onSaved={()=>{awards.reload();onSaved();}}><TextField name="reason" label={transactionLabel(uiLanguage, "Posting reason")} maxLength={2000}/></IdentityForm>}</li>)}</ul></section>;}
function SubmitDestination({ onSaved }: { onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [channel, setChannel] = useState(''), id = useId();
  return <details><summary>{copy.addDestination}</summary><IdentityForm action="tutor/payout-destinations" submitLabel={copy.addDestination} successMessage={copy.submitted} clearFieldsOnSuccess onSaved={onSaved} payload={form => ({ channel, identifier: String(form.get('identifier')), payee_name: String(form.get('payee_name')).trim() })}><Select name="channel" label={copy.channel} value={channel} onChange={setChannel}><option value="">—</option><option value="instapay">{copy.instapay}</option><option value="vodafone_cash">{copy.vodafone_cash}</option></Select><div className={formStyles.field}><label htmlFor={id}>{copy.identifier}</label><input id={id} name="identifier" type="password" autoComplete="off" maxLength={256} required /></div><TextField name="payee_name" label={copy.payee} maxLength={200} /></IdentityForm></details>;
}
function VerifyDestination({ destination, onSaved }: { destination: PayoutDestination; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [decision, setDecision] = useState(''), [evidence, setEvidence] = useState('');
  return <details><summary>{copy.verify}</summary><IdentityForm action={`payout-destinations/${destination.destination_id}/verify`} submitLabel={copy.verify} successMessage={copy.verified} disabled={!evidence || !decision} resettable={false} onSaved={onSaved} payload={form => ({ evidence_file_id: evidence, decision, reason: String(form.get('reason')).trim(), expected_version: destination.version })}><Select name="decision" label={copy.decision} value={decision} onChange={setDecision}><option value="">—</option><option value="verified">{copy.approveDestination}</option><option value="rejected">{copy.rejectDestination}</option></Select><TextField name="reason" label={copy.reason} maxLength={2000} /><EvidenceSelect action="verify_payout_destination" targetId={destination.destination_id} value={evidence} onChange={setEvidence} label={copy.evidence} /></IdentityForm></details>;
}
function AuthorizePayout({ tutor, earnings, destinations, onSaved }: { tutor: PayoutTutor; earnings: Earning[]; destinations: PayoutDestination[]; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [destination, setDestination] = useState(''), [selected, setSelected] = useState<string[]>([]), allowed = destinations.filter(row => row.verification_status === 'verified' && row.verified_version_id && tutor.enabled_channels.includes(row.channel));
  return <details className={styles.section}><summary>{copy.payout}</summary><IdentityForm action="payouts" submitLabel={copy.payout} successMessage={copy.authorized} disabled={!selected.length || !allowed.some(row => row.verified_version_id === destination)} onSaved={onSaved} payload={form => ({ tutor_id: tutor.tutor_id, destination_version_id: destination, allocations: earnings.filter(row => selected.includes(row.earning_id)).map(row => ({ earning_id: row.earning_id, amount_minor: amountField(form, `earning-${row.earning_id}`, { max: row.available_minor }) })) })}><p>{copy.payoutIntro}</p><Select name="destination" label={copy.destination} value={destination} onChange={setDestination}><option value="">{copy.chooseDestination}</option>{allowed.map(row => <option key={row.destination_id} value={row.verified_version_id!}>{copy[row.channel]} · {row.masked_identifier}</option>)}</Select><fieldset><legend>{copy.selectEarnings}</legend>{earnings.filter(row => row.available_minor > 0).map(row => <div key={row.earning_id}><label className={styles.notice}><input type="checkbox" checked={selected.includes(row.earning_id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, row.earning_id] : ids.filter(id => id !== row.earning_id))} />{copy.include}: <CairoTimestamp value={row.effective_at} /> · {money(row.available_minor, 'EGP', uiLanguage)}</label>{selected.includes(row.earning_id) && <AmountField name={`earning-${row.earning_id}`} label={copy.amount} value={row.available_minor} />}</div>)}</fieldset></IdentityForm></details>;
}
function PayoutActions({ attempt, destinations, onSaved }: { attempt: PayoutAttempt; destinations: PayoutDestination[]; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [destination, setDestination] = useState(attempt.destination_version_id), [outcome, setOutcome] = useState(''), [account, setAccount] = useState(''), [evidence, setEvidence] = useState('');
  const cash = usePaymentRecord<{ items: FinanceCashAccount[] }>(attempt.can_reconcile || attempt.can_reverse ? 'finance/cash-accounts' : null);
  return <>{['pending', 'unknown'].includes(attempt.state) && <RevealDestination attempt={attempt} />}{attempt.can_retry && <IdentityForm action={`payouts/${attempt.payout_attempt_id}/retry`} submitLabel={copy.retry} successMessage={copy.retried} onSaved={onSaved} resettable={false} payload={() => ({ destination_version_id: destination, expected_version: attempt.version })}><Select name="destination" label={copy.destination} value={destination} onChange={setDestination}><option value="">{copy.chooseDestination}</option>{destinations.filter(row => row.verification_status === 'verified' && row.verified_version_id).map(row => <option key={row.destination_id} value={row.verified_version_id!}>{copy[row.channel]} · {row.masked_identifier}</option>)}</Select></IdentityForm>}{attempt.can_reconcile && <details><summary>{copy.reconcile}</summary><IdentityForm action={`payouts/${attempt.payout_attempt_id}/reconcile`} submitLabel={copy.reconcile} successMessage={copy.reconciled} disabled={!evidence || !outcome || (outcome === 'settled' && !account)} onSaved={onSaved} resettable={false} payload={form => ({ outcome, receiving_account_id: outcome === 'settled' ? account : null, external_reference: String(form.get('external_reference')).trim(), evidence_file_id: evidence, settled_at: outcome === 'settled' ? instantField(form, 'settled_at') : null, expected_version: attempt.version })}><Select name="outcome" label={copy.outcome} value={outcome} onChange={value => { setOutcome(value); setEvidence(''); }}><option value="">—</option>{['settled', 'failed', 'unknown'].map(value => <option key={value} value={value}>{copy.states[value]}</option>)}</Select>{outcome === 'settled' && <><CashSelect items={cash.data?.items || []} value={account} onChange={setAccount} /><CairoInput name="settled_at" label={copy.settledAt} /></>}<TextField name="external_reference" label={copy.external} maxLength={200} /><EvidenceSelect action="reconcile_payout" targetId={attempt.payout_attempt_id} value={evidence} onChange={setEvidence} label={copy.evidence} /></IdentityForm></details>}{attempt.can_reverse && <ReversePayout attempt={attempt} accounts={cash.data?.items || []} onSaved={onSaved} />}</>;
}
function CashSelect({ items, value, onChange }: { items: FinanceCashAccount[]; value: string; onChange: (value: string) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 return <Select name="cash_account" label={copy.cashAccount} value={value} onChange={onChange}><option value="">{copy.chooseAccount}</option>{items.filter(row => row.enabled).map(row => <option key={row.receiving_account_id} value={row.receiving_account_id}>{row.label}</option>)}</Select>; }
function ReversePayout({ attempt, accounts, onSaved }: { attempt: PayoutAttempt; accounts: FinanceCashAccount[]; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [account, setAccount] = useState(''), [evidence, setEvidence] = useState('');
  return <details><summary>{copy.reverse}</summary><IdentityForm action={`payouts/${attempt.payout_attempt_id}/reversals`} submitLabel={copy.reverse} successMessage={copy.reversed} disabled={!evidence || !account} resettable={false} onSaved={onSaved} payload={form => ({ amount_minor: amountField(form, 'amount', { max: attempt.amount_minor - attempt.returned_minor }), receiving_account_id: account, external_reference: String(form.get('external_reference')).trim(), evidence_file_id: evidence, effective_at: instantField(form, 'effective_at'), reason: String(form.get('reason')).trim(), expected_version: attempt.version })}><AmountField name="amount" label={copy.returnAmount} /><CashSelect items={accounts} value={account} onChange={setAccount} /><CairoInput name="effective_at" label={copy.effectiveAt} /><TextField name="external_reference" label={copy.external} maxLength={200} /><TextField name="reason" label={copy.reason} maxLength={2000} /><EvidenceSelect action="record_payout_reversal" targetId={attempt.payout_attempt_id} value={evidence} onChange={setEvidence} label={copy.evidence} /></IdentityForm></details>;
}
function RevealDestination({ attempt }: { attempt: PayoutAttempt }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const hydrated = useHydrated(), [identifier, setIdentifier] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false), id = useId();
  return <details onToggle={event => { if (!event.currentTarget.open) setIdentifier(''); }}><summary>{copy.reveal}</summary>{identifier ? <><p><bdi>{identifier}</bdi></p><button type="button" className={formStyles.signout} onClick={() => setIdentifier('')}>{copy.hide}</button></> : <form onSubmit={async event => { event.preventDefault(); if (!hydrated || pending) return; const form = new FormData(event.currentTarget); setPending(true); setError(''); try { const response = await fetch(`/api/v1/payout-destinations/${attempt.destination_id}/reveal`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payout_attempt_id: attempt.payout_attempt_id, reason: String(form.get('reason')).trim() }) }); const body = await response.json(); if (!response.ok || typeof body.data?.identifier !== 'string') throw new Error(copy.revealFailed); setIdentifier(body.data.identifier); } catch { setError(copy.revealFailed); } finally { setPending(false); } }}><div className={formStyles.field}><label htmlFor={id}>{copy.revealReason}</label><input id={id} name="reason" maxLength={2000} required disabled={!hydrated || pending} /></div><button type="submit" className={formStyles.signout} disabled={!hydrated || pending}>{copy.reveal}</button></form>}{error && <p role="alert" className={formStyles.error}>{error}</p>}</details>;
}
