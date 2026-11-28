'use client';
import { useState } from 'react';
import type { CashReconciliation, CashReconciliationSource, TutorObligation, FinanceEntry } from '@/modules/analytics/finance';
import { formatFinanceAmount } from '@/modules/shared/format';
import { IdentityForm, TextField } from '../identity-form';
import { CairoTimestamp } from '../booking/shared';
import { EvidenceSelect, PaymentReadState, usePaymentList } from '../payments/shared';
import styles from '../files/files.module.css';
import layoutStyles from '../auth.module.css';
import { useSiteLanguage } from '@/components/site-language';
import { transactionLabel } from '@/locales/ar-transaction/labels';


export function CashVarianceQueue() {
  const uiLanguage = useSiteLanguage();

  const controls = usePaymentList<CashReconciliation>('finance/cash-reconciliations');
  return <section className={styles.section}><h2>{transactionLabel(uiLanguage, "Cash close investigations")}</h2><p>{transactionLabel(uiLanguage, "Original statement comparisons stay unchanged. Resolve a difference after independently recorded source transactions bring the original control into balance. Later historical postings can reopen it.")}</p><PaymentReadState pending={!controls.items} {...controls} />{controls.items?.length === 0 && <p>{transactionLabel(uiLanguage, "No cash comparisons have been recorded.")}</p>}<ul className={`${styles.list} ${layoutStyles.recordGrid}`}>{controls.items?.map(row => <li className={styles.file} key={`${row.reconciliation_id}-${row.version}`}><h3>{row.state}</h3><p>{transactionLabel(uiLanguage, "Owner")} {row.owner_account_id} {transactionLabel(uiLanguage, "· Account")} {row.receiving_account_id}</p><p>{transactionLabel(uiLanguage, "Statement at")} <CairoTimestamp value={row.balance_at} /> {transactionLabel(uiLanguage, "· Original difference")} {formatFinanceAmount(row.difference_minor, uiLanguage === 'ar' ? 'ar-EG' : 'en-EG')} {transactionLabel(uiLanguage, "· Current difference")} {formatFinanceAmount(row.current_difference_minor, uiLanguage === 'ar' ? 'ar-EG' : 'en-EG')}</p><p>{row.reason}</p>{row.resolution && <p>{transactionLabel(uiLanguage, "Resolution")} {row.resolution.resolution_id} · <CairoTimestamp value={row.resolution.resolved_at} /> · {row.resolution.reason}</p>}{['open', 'reopened'].includes(row.state) && <CashResolution row={row} reload={controls.reload} />}</li>)}</ul></section>;
}
function CashResolution({ row, reload }: { row: CashReconciliation; reload: () => void }) {
  const uiLanguage = useSiteLanguage();

  const sources = usePaymentList<CashReconciliationSource>(`finance/cash-reconciliations/${row.reconciliation_id}/sources`), [selected, setSelected] = useState<string[]>([]), [evidence, setEvidence] = useState('');
  return <details><summary>{transactionLabel(uiLanguage, "Review sources and resolve")}</summary><PaymentReadState pending={!sources.items} {...sources} />{sources.items?.length === 0 && <p>{transactionLabel(uiLanguage, "No later settled source postings affect this control yet. Record the actual verified collection, refund, expense or payout correction first.")}</p>}<ul className={styles.list}>{sources.items?.map(source => <li className={styles.file} key={source.transaction_id}><label><input type="checkbox" checked={selected.includes(source.transaction_id)} onChange={event => setSelected(current => event.target.checked ? [...current, source.transaction_id] : current.filter(id => id !== source.transaction_id))} /> {source.source_type.replaceAll('_', ' ')} · {formatFinanceAmount(source.cash_delta_minor, uiLanguage === 'ar' ? 'ar-EG' : 'en-EG')}</label><p>{transactionLabel(uiLanguage, "Source")} {source.source_id} {transactionLabel(uiLanguage, "· Effective")} <CairoTimestamp value={source.effective_at} /></p></li>)}</ul><IdentityForm action={`finance/cash-reconciliations/${row.reconciliation_id}/resolve`} submitLabel={transactionLabel(uiLanguage, "Resolve evidenced difference")} successMessage={transactionLabel(uiLanguage, "Resolution saved with its actual source transactions. Original comparison retained.")} onSaved={reload} disabled={selected.length === 0 || !evidence || row.current_difference_minor !== 0} payload={form => ({ correction_transaction_ids: selected, evidence_file_id: evidence, reason: String(form.get('reason')).trim(), expected_version: row.version })}><TextField name="reason" label={transactionLabel(uiLanguage, "Investigation and resolution")} maxLength={2000} multiline /><EvidenceSelect action="cash_reconciliation" targetId={row.receiving_account_id} value={evidence} onChange={setEvidence} label={transactionLabel(uiLanguage, "Independent resolution evidence")} />{row.current_difference_minor !== 0 && <p>{transactionLabel(uiLanguage, "The current ledger still differs from the observed statement. Source reconciliation is required before closure.")}</p>}</IdentityForm></details>;
}
export function TutorObligations({ range, side }: { range: { from: string; to: string; as_of: string }; side: 'payable' | 'advance' }) {
  const uiLanguage = useSiteLanguage();

  const query = new URLSearchParams({ ...range, side }).toString(), rows = usePaymentList<TutorObligation>(`finance/tutor-obligations?${query}`), [selected, setSelected] = useState<string | null>(null);
  return <section className={styles.section}><h3>{side === 'advance' ? transactionLabel(uiLanguage, "Tutor advances") : transactionLabel(uiLanguage, "Gross tutor payables")}</h3><p>{transactionLabel(uiLanguage, "Each tutor retains their own balance. An advance cannot reduce another tutor’s payable.")}</p><PaymentReadState pending={!rows.items} {...rows} /><ul className={styles.list}>{rows.items?.map(row => <li className={styles.file} key={row.tutor_id}><button type="button" onClick={() => setSelected(row.tutor_id)}>{row.tutor_name}: {formatFinanceAmount(side === 'advance' ? row.advance_minor : row.payable_minor, uiLanguage === 'ar' ? 'ar-EG' : 'en-EG')}</button></li>)}</ul>{selected && <TutorObligationEntries key={selected} tutorId={selected} range={range} />}</section>;
}
function TutorObligationEntries({ tutorId, range }: { tutorId: string; range: { from: string; to: string; as_of: string } }) {
  const uiLanguage = useSiteLanguage();

  const rows = usePaymentList<FinanceEntry>(`finance/tutor-obligations/${tutorId}/entries?${new URLSearchParams(range)}`);
  return <><h4>{transactionLabel(uiLanguage, "Underlying tutor ledger entries")}</h4><PaymentReadState pending={!rows.items} {...rows} /><ul className={styles.list}>{rows.items?.map(row => <li className={styles.file} key={row.line_id}>{row.source_type.replaceAll('_', ' ')} · {formatFinanceAmount(row.signed_minor, uiLanguage === 'ar' ? 'ar-EG' : 'en-EG')}<p>{transactionLabel(uiLanguage, "Source")} {row.source_id} · <CairoTimestamp value={row.effective_at} /></p></li>)}</ul></>;
}
