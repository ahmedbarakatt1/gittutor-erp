'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FinancialException, TransferReversalDetail } from '@/modules/payments/queries';
import type { PackageDetail } from '@/modules/packages/queries';
import { paymentCopy as copy } from '@/locales/payments';
import { IdentityForm, TextField } from '../identity-form';
import { Select, CairoTimestamp, money } from '../booking/shared';
import { AmountField, amountField, EvidenceSelect, PaymentReadState, State, usePaymentList, usePaymentRecord } from './shared';
import styles from './payments.module.css';

export function FinancialExceptions() {
  const [state, setState] = useState('open'), [selected, setSelected] = useState<FinancialException | null>(null);
  const records = usePaymentList<FinancialException>(`financial-exceptions?state=${state}`);
  return <><Link className={styles.link} href="/admin/payments">{copy.incoming}</Link><section className={styles.section}><h2>{copy.exceptions}</h2><Select name="state" label={copy.state} value={state} onChange={setState}><option value="open">{copy.states.open}</option><option value="resolved">{copy.states.resolved}</option></Select><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.none}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.exception_id}><div className={styles.row}><h3>{row.kind.replaceAll('_', ' ')}</h3><State value={row.state} /></div><p>{copy.recovery}: <bdi>{money(row.signed_exposure_minor)}</bdi></p><p><CairoTimestamp value={row.created_at} /></p>{row.resolution_target && <button type="button" className={styles.link} onClick={() => setSelected(row)}>{row.resolution_target.kind === 'transfer_reversal' ? copy.resolveReversal : copy.requalify}</button>}</li>)}</ul></section>{selected?.resolution_target?.kind === 'transfer_reversal' && <ResolveTransferReversal key={selected.resolution_target.reversal_id} id={selected.resolution_target.reversal_id} onSaved={records.reload} />}{selected?.resolution_target?.kind === 'package_financing_hold' && <ResolvePackageHold key={selected.resolution_target.package_purchase_id} id={selected.resolution_target.package_purchase_id} onSaved={records.reload} />}</>;
}
function ResolveTransferReversal({ id, onSaved }: { id: string; onSaved: () => void }) {
  const record = usePaymentRecord<TransferReversalDetail>(`transfer-reversals/${id}`), allocations = usePaymentList<TransferReversalDetail['allocation_page']['items'][number]>(`transfer-reversals/${id}`, 'allocation_page', 'allocation_cursor'); const reversal = record.data;
  return <section className={styles.section}><h2>{copy.resolveReversal}</h2><PaymentReadState pending={!reversal} {...record} />{reversal && <><h3>{reversal.transfer.external_id}</h3><dl className={styles.facts}><div><dt>{copy.sourceLoss}</dt><dd><bdi>{money(reversal.amount_minor)}</bdi></dd></div><div><dt>{copy.unresolved}</dt><dd><bdi>{money(reversal.remaining_unresolved_minor)}</bdi></dd></div></dl><PaymentReadState pending={!allocations.items} {...allocations} /><IdentityForm key={reversal.version} action={`transfer-reversals/${id}/resolve`} submitLabel={copy.resolveReversal} successMessage={copy.reversalResolved} disabled={!allocations.items || Boolean(allocations.error) || reversal.remaining_unresolved_minor === 0} resettable={false} payload={form => {
    const portions = (allocations.items || []).map(row => ({ allocation_id: row.allocation_id, amount_minor: amountField(form, `amount-${row.allocation_id}`, { max: row.remaining_resolvable_minor, allowZero: true }) })).filter(row => row.amount_minor > 0);
    const unapplied = amountField(form, 'unapplied', { max: reversal.unapplied_resolvable_minor, allowZero: true });
    const total = portions.reduce((sum, row) => sum + BigInt(row.amount_minor), BigInt(unapplied)); if (total === 0n || total > BigInt(reversal.remaining_unresolved_minor)) throw new Error('AMOUNT_OUT_OF_RANGE');
    return { allocations: portions, unapplied_minor: unapplied, reason: String(form.get('reason')), expected_version: reversal.version };
  }} onSaved={() => { record.reload(); allocations.reload(); onSaved(); }}>{allocations.items?.map(row => <div key={row.allocation_id} className={styles.target}><h3>{row.title}</h3><p>{row.learner.display_name}</p><AmountField name={`amount-${row.allocation_id}`} label={copy.allocationPortion} value={0} allowZero max={row.remaining_resolvable_minor} /></div>)}<AmountField name="unapplied" label={copy.unappliedPortion} value={0} allowZero max={reversal.unapplied_resolvable_minor} /><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></>}</section>;
}
function ResolvePackageHold({ id, onSaved }: { id: string; onSaved: () => void }) {
  const record = usePaymentRecord<PackageDetail>(`packages/${id}`), [file, setFile] = useState(''); const item = record.data?.package;
  return <section className={styles.section}><h2>{copy.requalify}</h2><PaymentReadState pending={!item} {...record} />{item && <><h3>{item.title} · {item.learner.display_name}</h3><p className={styles.notice}>{copy.reasons.FINANCING_HOLD}</p><Link className={styles.link} href={`/admin/packages?package=${id}`}>{copy.review}</Link><IdentityForm key={item.version} action={`packages/${id}/resolve-financing-hold`} submitLabel={copy.requalify} successMessage={copy.requalified} resettable={false} disabled={!file || item.financing_state !== 'held'} payload={form => ({ reason: String(form.get('reason')), evidence_file_id: file, expected_version: item.version })} onSaved={() => { record.reload(); onSaved(); }}><TextField name="reason" label={copy.reason} maxLength={2000} /><EvidenceSelect action="resolve_package_financing_hold" targetId={id} value={file} onChange={setFile} /></IdentityForm></>}</section>;
}
