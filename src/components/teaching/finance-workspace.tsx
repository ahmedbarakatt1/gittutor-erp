'use client';

import { useState, useId } from 'react';
import type { Expense, FinanceSummary, FinanceEntry, FinanceCashAccount } from '@/modules/analytics/finance';
import { parseScaledIntegerInput, formatFinanceAmount } from '@/modules/shared/format';
import { financeCopy as copy } from '@/locales/finance';
import { IdentityForm, TextField } from '../identity-form';
import { CairoInput, CairoTimestamp, instantField, money, Select } from '../booking/shared';
import { AmountField, amountField, EvidenceSelect, PaymentReadState, usePaymentList, usePaymentRecord } from '../payments/shared';
import { CashVarianceQueue, TutorObligations } from './finance-controls';
import { useHydrated } from '../use-hydrated';
import styles from '../files/files.module.css';
import formStyles from '../auth.module.css';
import { financeCopy as arabicFinanceCopy } from '@/locales/ar-transaction/finance';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicFinanceCopy },
};


type Range = { from: string; to: string; as_of: string };
const accounts: Record<string, string[]> = { earned_revenue_minor: ['tuition_revenue'], tutor_expense_minor: ['tutor_expense'], operating_expense_minor: ['operating_expense'], promotional_subsidy_minor: ['promotional_subsidy_expense'], operating_profit_minor: ['tuition_revenue', 'tutor_expense', 'operating_expense', 'promotional_subsidy_expense'], cash_inflow_minor: ['channel_cash'], cash_outflow_minor: ['channel_cash'], net_cash_movement_minor: ['channel_cash'], cash_minor: ['channel_cash'], receivable_minor: ['receivable'], customer_credit_minor: ['unapplied_customer_funds'], deferred_tuition_minor: ['deferred_tuition'], package_obligation_minor: ['deferred_package_obligation'], cancellation_obligation_minor: ['deferred_cancellation_obligation'], tutor_payable_minor: ['tutor_payable'], unattributed_tutor_net_minor: ['tutor_payable'], expense_payable_minor: ['expense_payable'] };
export function FinanceWorkspace() {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [range, setRange] = useState<Range | null>(null), hydrated = useHydrated();
  return <><form className={formStyles.form} onSubmit={event => { event.preventDefault(); if (!hydrated) return; const form = new FormData(event.currentTarget); setRange({ from: String(form.get('from')), to: String(form.get('to')), as_of: instantField(form, 'as_of') }); }}><fieldset className={`${formStyles.formFields} ${formStyles.filterFields}`} disabled={!hydrated}><TextField name="from" label={copy.from} type="date" /><TextField name="to" label={copy.to} type="date" /><CairoInput name="as_of" label={copy.asOf} /><p>{copy.basis}</p><button className={formStyles.primary} type="submit">{copy.apply}</button></fieldset></form>{range && <FinanceReport key={JSON.stringify(range)} range={range} />}<ExpenseWorkspace /><CashReconciliation /><CashVarianceQueue /></>;
}
function FinanceReport({ range }: { range: Range }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const query = new URLSearchParams(range).toString(), report = usePaymentRecord<FinanceSummary>(`finance/summary?${query}`), [selected, setSelected] = useState<{ metric: string; cumulative: boolean } | null>(null);
  return <section className={styles.section}><PaymentReadState pending={!report.data} {...report} />{report.data && <><p className={styles.notice}>{report.data.ledger_balanced ? copy.balanced : copy.imbalance}</p>{([{ title: copy.period, data: report.data.period, cumulative: false }, { title: copy.balances, data: report.data.balances, cumulative: true }]).map(group => <section key={group.title}><h2>{group.title}</h2><dl className={formStyles.metricGrid}>{Object.entries(group.data).map(([metric, amount]) => <div key={metric}><dt>{copy.metrics[metric]}</dt><dd><button type="button" className={formStyles.signout} onClick={() => setSelected({ metric, cumulative: group.cumulative })}>{formatFinanceAmount(amount, uiLanguage === 'ar' ? 'ar-EG' : 'en-EG')}</button></dd></div>)}</dl></section>)}{selected && (selected.metric === 'gross_tutor_payable_minor' || selected.metric === 'tutor_advance_minor' ? <TutorObligations key={selected.metric} range={range} side={selected.metric === 'tutor_advance_minor' ? 'advance' : 'payable'} /> : <FinanceEntries key={`${selected.metric}-${selected.cumulative}`} range={range} metric={selected.metric} cumulative={selected.cumulative} />)}</>}</section>;
}
function FinanceEntries({ range, metric, cumulative }: { range: Range; metric: string; cumulative: boolean }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<FinanceEntry>(`finance/entries?${new URLSearchParams({ ...range, from: cumulative ? '2000-01-01' : range.from, account_codes: accounts[metric].join(',') })}`);
  return <section className={styles.section}><h3>{copy.entries}: {copy.metrics[metric]}</h3><p>{copy.entryBasis}</p><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.empty}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.line_id}><strong>{money(row.signed_minor, row.currency, uiLanguage)}</strong><p>{row.account_code.replaceAll('_', ' ')} · {row.source_type.replaceAll('_', ' ')}</p><p>{copy.effective}: <CairoTimestamp value={row.effective_at} /></p><p>{copy.recorded}: <CairoTimestamp value={row.recorded_at} /></p><p>{copy.source}: <bdi>{row.source_id}</bdi></p></li>)}</ul></section>;
}
function ExpenseWorkspace() {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const expenses = usePaymentList<Expense>('expenses'), cash = usePaymentRecord<{ items: FinanceCashAccount[] }>('finance/cash-accounts'), [evidence, setEvidence] = useState(''), [category, setCategory] = useState('');
  return <section className={styles.section}><h2>{copy.expenses}</h2><details><summary>{copy.recordExpense}</summary><IdentityForm action="expenses" submitLabel={copy.recordExpense} successMessage={copy.expenseSaved} disabled={!evidence} onSaved={expenses.reload} payload={form => ({ category, amount_minor: amountField(form, 'amount'), currency: 'EGP', incurred_at: instantField(form, 'incurred_at'), description: String(form.get('description')).trim(), evidence_file_id: evidence })}><Select name="category" label={copy.category} value={category} onChange={setCategory}><option value="">—</option>{Object.entries(copy.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><AmountField name="amount" label={copy.amount} /><CairoInput name="incurred_at" label={copy.incurred} /><TextField name="description" label={copy.description} multiline maxLength={2000} /><EvidenceSelect action="record_expense" targetId={null} value={evidence} onChange={setEvidence} label={copy.evidence} /></IdentityForm></details><PaymentReadState pending={!expenses.items} {...expenses} /><ul className={styles.list}>{expenses.items?.map(expense => <li key={`${expense.expense_id}-${expense.version}`}><h3>{expense.description}</h3><p>{copy.categories[expense.category]} · <CairoTimestamp value={expense.incurred_at} /></p><p>{copy.amount}: {money(expense.amount_minor, 'EGP', uiLanguage)} · {copy.paid}: {money(expense.paid_minor, 'EGP', uiLanguage)} · {copy.remaining}: <strong>{money(expense.payable_minor, 'EGP', uiLanguage)}</strong></p>{expense.payable_minor > 0 && <SettleExpense expense={expense} accounts={cash.data?.items || []} onSaved={() => { expenses.reload(); cash.reload(); }} />}</li>)}</ul></section>;
}
function SettleExpense({ expense, accounts, onSaved }: { expense: Expense; accounts: FinanceCashAccount[]; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [account, setAccount] = useState(''), [evidence, setEvidence] = useState('');
  return <details><summary>{copy.settle}</summary><IdentityForm action={`expenses/${expense.expense_id}/settlements`} submitLabel={copy.settle} successMessage={copy.settled} disabled={!evidence || !account} resettable={false} onSaved={onSaved} payload={form => ({ amount_minor: amountField(form, 'amount', { max: expense.payable_minor }), receiving_account_id: account, external_reference: String(form.get('reference')).trim(), settled_at: instantField(form, 'settled_at'), evidence_file_id: evidence, expected_version: expense.version })}><p>{copy.settleIntro}</p><AmountField name="amount" label={copy.paymentAmount} /><Select name="account" label={copy.account} value={account} onChange={value => { setAccount(value); setEvidence(''); }}><option value="">{copy.choose}</option>{accounts.filter(row => row.enabled).map(row => <option key={row.receiving_account_id} value={row.receiving_account_id}>{row.label}</option>)}</Select><TextField name="reference" label={copy.reference} maxLength={200} /><CairoInput name="settled_at" label={copy.settledAt} /><EvidenceSelect action="record_expense_settlement" targetId={expense.expense_id} value={evidence} onChange={setEvidence} label={copy.evidence} /></IdentityForm></details>;
}
function CashReconciliation() {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const cash = usePaymentRecord<{ items: FinanceCashAccount[] }>('finance/cash-accounts'), [selected, setSelected] = useState(''), [evidence, setEvidence] = useState(''), id = useId();
  const current = cash.data?.items.find(row => row.receiving_account_id === selected);
  return <section className={styles.section}><h2>{copy.cash}</h2><p>{copy.reconcileIntro}</p><PaymentReadState pending={!cash.data} {...cash} />{cash.data?.items.length === 0 && <p>{copy.noAccounts}</p>}<Select name="reconcile_account" label={copy.account} value={selected} onChange={value => { setSelected(value); setEvidence(''); }}><option value="">{copy.choose}</option>{cash.data?.items.map(row => <option key={row.receiving_account_id} value={row.receiving_account_id}>{row.label}</option>)}</Select>{current && <><p>{copy.recordedBalance}: {money(current.balance_minor, 'EGP', uiLanguage)}</p>{current.last_reconciliation && <aside className={styles.notice}><h3>{copy.lastComparison}</h3><CairoTimestamp value={current.last_reconciliation.balance_at} /><p>{copy.observed}: {money(current.last_reconciliation.observed_balance_minor, 'EGP', uiLanguage)}</p><p>{copy.difference}: {money(current.last_reconciliation.difference_minor, 'EGP', uiLanguage)}</p></aside>}<IdentityForm key={selected} action="finance/cash-reconciliations" submitLabel={copy.reconcile} successMessage={copy.reconciled} disabled={!evidence} onSaved={cash.reload} payload={form => { const raw = String(form.get('balance')); return { receiving_account_id: selected, observed_balance_minor: (raw.startsWith('-') ? -1 : 1) * parseScaledIntegerInput(raw.replace(/^-/, ''), 2), balance_at: instantField(form, 'balance_at'), evidence_file_id: evidence, reason: String(form.get('reason')).trim() }; }}><div className={formStyles.field}><label htmlFor={id}>{copy.observed}</label><input id={id} name="balance" type="text" inputMode="decimal" pattern="-?[0-9]+(\.[0-9]{1,2})?" required /></div><CairoInput name="balance_at" label={copy.balanceAt} /><TextField name="reason" label={copy.reason} multiline maxLength={2000} /><EvidenceSelect action="cash_reconciliation" targetId={selected} value={evidence} onChange={setEvidence} label={copy.evidence} /></IdentityForm></>}</section>;
}
