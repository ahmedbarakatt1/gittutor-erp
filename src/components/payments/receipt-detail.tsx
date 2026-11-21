'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ChargeAmendmentFundingOption, ChargeSummary, CustomerPayment, PaymentPlan, ReceiptVersion } from '@/modules/payments/queries';
import type { CustomerEnrollmentTransfer } from '@/modules/booking/enrollment-transfers';
import { transferCopy } from '@/locales/enrollment-transfers';
import { paymentCopy as copy } from '@/locales/payments';
import { IdentityForm, TextField } from '../identity-form';
import { Select, Check, CairoTimestamp, money } from '../booking/shared';
import { AmountField, amountField, ChargeFacts, EvidenceMetadata, EvidenceSelect, PaymentReadState, State, usePaymentList, usePaymentRecord } from './shared';
import type { PaymentLearner } from './customer-payments';
import styles from './payments.module.css';
import formStyles from '../auth.module.css';
import { transferCopy as arabicTransferCopy } from '@/locales/ar-transaction/enrollment-transfers';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy, transferCopy },
  ar: { copy: arabicPaymentCopy, transferCopy: arabicTransferCopy },
};


export function ReceiptDetail({ id }: { id: string }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const record = usePaymentRecord<CustomerPayment>(`payments/${id}`), [file, setFile] = useState('');
  const data = record.data;
  return <><PaymentReadState pending={!data} {...record} />{data && <><ChargeFacts charge={data.charge} /><section className={styles.section}><h2>{copy.review}</h2><dl className={styles.facts}><div><dt>{copy.reportedAmount}</dt><dd><bdi>{money(data.receipt.reported_amount_minor, 'EGP', uiLanguage)}</bdi></dd></div><div><dt>{copy.reference}</dt><dd>{data.receipt.reference}</dd></div><div><dt>{copy.recipient}</dt><dd>{data.receipt.receiving_account.approved_recipient_display}</dd></div><div><dt>{copy.evidenceState}</dt><dd><State value={data.receipt.evidence.state} /></dd></div><div><dt>{copy.review}</dt><dd><State value={data.receipt.review.state} /></dd></div><div><dt>{copy.submitted}</dt><dd><CairoTimestamp value={data.receipt.evidence.submitted_at} /></dd></div>{data.receipt.transferred_at && <div><dt>{copy.transferredAt}</dt><dd><CairoTimestamp value={data.receipt.transferred_at} /></dd></div>}</dl><p className={styles.notice}><strong>{copy.nextAction}:</strong> {data.receipt.review.next_action}</p>{data.matched_transfer && <p>{copy.incomingSettled}: <State value={data.matched_transfer.state} /> · <bdi>{money(data.matched_transfer.amount_minor, 'EGP', uiLanguage)}</bdi></p>}</section><details className={styles.disclosure}><summary>{copy.replacement}</summary><IdentityForm key={`replace-${data.receipt.version}`} action={`receipts/${id}/replace`} submitLabel={copy.replace} successMessage={copy.replaced} resettable={false} disabled={!file} payload={form => ({ file_id: file, reason: String(form.get('reason')), expected_version: data.receipt.version })} onSaved={record.reload}><EvidenceSelect chargeId={data.charge.charge_id} value={file} onChange={setFile} /><TextField name="reason" label={copy.replacementReason} maxLength={2000} /></IdentityForm></details><>{data.receipt.can_authorize_plan ? <PaymentPlanEditor receipt={data} onSaved={record.reload} /> : <p className={styles.notice}>{copy.planNeedsOwnProof}</p>}</><ReceiptHistory id={id} /><AllocationHistory id={id} /><Link className={styles.link} href="/learn/refunds">{copy.ownRefunds}</Link></>}</>;
}
function ReceiptHistory({ id }: { id: string }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<ReceiptVersion>(`receipts/${id}/versions`);
  return <section className={styles.section}><h2>{copy.receiptHistory}</h2><PaymentReadState pending={!records.items} {...records} /><ol className={styles.list}>{records.items?.map(row => <li key={row.evidence_version}><h3>{copy.evidenceVersion} {row.evidence_version} · {row.is_current ? copy.current : copy.earlier}</h3><State value={row.state} /><EvidenceMetadata evidence={row.file} /></li>)}</ol></section>;
}
function AllocationHistory({ id }: { id: string }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<{ allocation_id: string; charge_id: string; amount_minor: number; reversed_minor: number; created_at: string }>(`payments/${id}`, 'allocation_page', 'allocation_cursor');
  return <section className={styles.section}><h2>{copy.allocations}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p className={styles.empty}>{copy.noAllocations}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.allocation_id}><p><bdi>{money(row.amount_minor, 'EGP', uiLanguage)}</bdi> · <CairoTimestamp value={row.created_at} /></p>{row.reversed_minor > 0 && <p>{copy.reversed}: <bdi>{money(row.reversed_minor, 'EGP', uiLanguage)}</bdi></p>}<span className={styles.reference}>{copy.reference}: {row.allocation_id}</span></li>)}</ul></section>;
}
function PaymentPlanEditor({ receipt, onSaved }: { receipt: CustomerPayment; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const learners = usePaymentList<PaymentLearner>('me/payment-learners'), [learner, setLearner] = useState(receipt.charge.learner.learner_id), [selected, setSelected] = useState('');
  const charges = usePaymentList<ChargeSummary>(learner ? `me/charges?learner_id=${learner}` : null), plans = usePaymentList<PaymentPlan>(`receipts/${receipt.receipt.receipt_id}/payment-plans`);
  const [targets, setTargets] = useState<ChargeSummary[]>([receipt.charge]);
  const selectedCharge = charges.items?.find(row => row.charge_id === selected);
  return <details className={styles.disclosure}><summary>{copy.planTitle}</summary><p className={styles.intro}>{copy.planDescription}</p><Select name="target_learner" label={copy.targetLearner} value={learners.items?.some(row => row.learner_id === learner) ? learner : ''} onChange={value => { setLearner(value); setSelected(''); }}><option value="">{copy.chooseLearner}</option>{learners.items?.map(row => <option key={row.learner_id} value={row.learner_id}>{row.display_name}</option>)}</Select><PaymentReadState pending={!learners.items} {...learners} />{learner && <><Select name="target_charge" label={copy.chooseCharge} value={selected} onChange={setSelected}><option value="">{copy.chooseCharge}</option>{charges.items?.filter(row => !targets.some(target => target.charge_id === row.charge_id)).map(row => <option key={row.charge_id} value={row.charge_id}>{row.title} · {row.learner.display_name} · {money(row.balance_minor, 'EGP', uiLanguage)}</option>)}</Select><PaymentReadState pending={!charges.items} {...charges} /><button className={formStyles.signout} type="button" disabled={!selectedCharge} onClick={() => { if (selectedCharge) setTargets(rows => [...rows, selectedCharge]); setSelected(''); }}>{copy.addTarget}</button></>}<IdentityForm key={`plan-${receipt.receipt.version}`} action={`receipts/${receipt.receipt.receipt_id}/payment-plans`} submitLabel={copy.createPlan} successMessage={copy.planSaved} resettable={false} disabled={targets.length === 0} payload={form => {
    const rows = targets.map(target => ({ charge_id: target.charge_id, amount_minor: amountField(form, `amount-${target.charge_id}`), conditional_amendment_id: String(form.get(`amendment-${target.charge_id}`) || '') || null, ...(target.conditional_transfer_proposal_id ? { conditional_transfer_proposal_id: target.conditional_transfer_proposal_id } : {}) }));
    if (rows.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n) > BigInt(receipt.receipt.reported_amount_minor)) throw new Error('AMOUNT_OUT_OF_RANGE');
    return { targets: rows, expected_version: receipt.receipt.version };
  }} onSaved={() => { plans.reload(); onSaved(); }}>{targets.length === 0 && <p>{copy.noTargets}</p>}{targets.map(target => <PaymentTarget key={target.charge_id} charge={target} remove={() => setTargets(rows => rows.filter(row => row.charge_id !== target.charge_id))} />)}<Check name="consent" label={copy.planConsent} /></IdentityForm><h3>{copy.currentPlans}</h3><PaymentReadState pending={!plans.items} {...plans} /><ul className={styles.list}>{plans.items?.map(plan => <li key={plan.payment_plan_id}><p>{copy.targets}: {plan.targets.length}</p>{plan.targets.map((target, index) => <p key={target.charge_id}>{copy.target} {index + 1}: <bdi>{money(target.amount_minor, 'EGP', uiLanguage)}</bdi></p>)}<p className={styles.reference}>{copy.reference}: {plan.payment_plan_id.slice(0, 8)}</p></li>)}</ul></details>;
}

function PaymentTarget({ charge, remove }: { charge: ChargeSummary; remove: () => void }) {
  return charge.conditional_transfer_proposal_id ? <TransferPaymentTarget charge={charge} proposalId={charge.conditional_transfer_proposal_id} remove={remove} /> : <OrdinaryPaymentTarget charge={charge} remove={remove} />;
}
function TransferPaymentTarget({ charge, proposalId, remove }: { charge: ChargeSummary; proposalId: string; remove: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { transferCopy, copy } = textByLanguage[uiLanguage];

  const record = usePaymentRecord<CustomerEnrollmentTransfer>(`enrollment-transfer-proposals/${proposalId}?view=customer&learner_id=${charge.learner.learner_id}`);
  return <div className={styles.target}><h3>{charge.title}</h3><p>{charge.learner.display_name}</p><p className={styles.notice}>{transferCopy.held}</p><PaymentReadState pending={!record.data} {...record} />{record.data?.funding && <p>{transferCopy.additionalNeeded}: {money(record.data.funding.additional_required_minor, 'EGP', uiLanguage)}. {transferCopy.additionalExplanation}</p>}<AmountField name={`amount-${charge.charge_id}`} label={`${copy.targetAmount} — ${charge.title}`} /><button className={formStyles.signout} type="button" onClick={remove}>{copy.remove}</button></div>;
}
function OrdinaryPaymentTarget({ charge, remove }: { charge: ChargeSummary; remove: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const choices = usePaymentList<ChargeAmendmentFundingOption>(charge.enrollment_id ? `charges/${charge.charge_id}/amendment-funding-options` : null), [selected, setSelected] = useState(charge.conditional_amendment_id || 'ordinary');
  const choice = choices.items?.find(row => row.amendment_id === selected);
  const current = selected === 'ordinary' && !charge.conditional_amendment_id;
  return <div className={styles.target}><h3>{charge.title}</h3><p>{charge.learner.display_name} · {copy.balance}: <bdi>{money(charge.balance_minor, 'EGP', uiLanguage)}</bdi></p>{charge.enrollment_id && <><Select name={`funding-purpose-${charge.charge_id}`} label={`${copy.fundingPurpose} — ${charge.title}`} value={current ? 'ordinary' : choice?.amendment_id || ''} onChange={setSelected}><option value="">{copy.choose}</option>{!charge.conditional_amendment_id && <option value="ordinary">{copy.currentTuition}</option>}{choices.items?.map(row => <option key={row.amendment_id} value={row.amendment_id}>{row.title} · {money(row.additional_required_minor, 'EGP', uiLanguage)}</option>)}</Select><PaymentReadState pending={!choices.items} {...choices} />{choice && <p className={styles.notice}>{copy.reasons.AMENDMENT_PENDING} {copy.additional}: <bdi>{money(choice.additional_required_minor, 'EGP', uiLanguage)}</bdi> · {copy.expires}: <CairoTimestamp value={choice.expires_at} /></p>}</>}<input type="hidden" name={`amendment-${charge.charge_id}`} value={choice?.amendment_id || ''} /><AmountField name={`amount-${charge.charge_id}`} label={`${copy.targetAmount} — ${charge.title}`} /><button className={formStyles.signout} type="button" onClick={remove}>{copy.remove}</button></div>;
}
