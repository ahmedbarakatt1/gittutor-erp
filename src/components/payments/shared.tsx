'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ChargeSummary, ConfirmationResult, SafeEvidence } from '@/modules/payments/queries';
import { parseScaledIntegerInput, scaledIntegerInput } from '@/modules/shared/format';
import { paymentCopy as copy } from '@/locales/payments';
import { fileCopy } from '@/locales/files';
import { EvidenceUpload } from '../files/evidence-upload';
import { Select, money, CairoTimestamp } from '../booking/shared';
import styles from './payments.module.css';
import formStyles from '../auth.module.css';

type Page<T> = { items: T[]; next_cursor: string | null };
export function usePaymentRecord<T>(path: string | null, keepDataOnRefresh = false) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string }>({ path });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    fetch(`/api/v1/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (controller.signal.aborted) return;
      if (!response.ok) { setState({ path, error: response.status === 403 || response.status === 404 ? copy.permission : copy.failed }); return; }
      setState({ path, data: body.data });
    }).catch(() => { if (!controller.signal.aborted) setState({ path, error: copy.failed }); });
    return () => controller.abort();
  }, [path, attempt]);
  return { data: state.path === path ? state.data : undefined, error: state.path === path ? state.error : undefined, reload: () => { if (!keepDataOnRefresh) setState({ path }); setAttempt(value => value + 1); } };
}
export function usePaymentList<T>(path: string | null, pageField?: string, cursorParameter = 'cursor') {
  const [state, setState] = useState<{ path: string | null; page?: Page<T>; error?: string }>({ path });
  const [attempt, setAttempt] = useState(0), [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0), controllers = useRef(new Set<AbortController>()), paging = useRef(false);
  const invalidate = useCallback(() => { generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); paging.current = false; return generation.current; }, []);
  useEffect(() => {
    const current = invalidate(); if (!path) return;
    const controller = new AbortController(); controllers.current.add(controller);
    fetch(`/api/v1/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (controller.signal.aborted || current !== generation.current) return;
      setLoadingMore(false);
      const result = pageField ? body.data?.[pageField] : body.data;
      if (!response.ok || !Array.isArray(result?.items)) { setState({ path, error: response.status === 403 ? copy.permission : copy.failed }); return; }
      setState({ path, page: result });
    }).catch(() => { if (!controller.signal.aborted && current === generation.current) { setLoadingMore(false); setState({ path, error: copy.failed }); } }).finally(() => controllers.current.delete(controller));
    return () => { invalidate(); };
  }, [path, pageField, attempt, invalidate]);
  const page = state.path === path ? state.page : undefined, error = state.path === path ? state.error : undefined;
  async function loadMore() {
    if (!path || !page?.next_cursor || paging.current) return;
    const current = generation.current, controller = new AbortController(); controllers.current.add(controller); paging.current = true; setLoadingMore(true);
    try {
      const response = await fetch(`/api/v1/${path}${path.includes('?') ? '&' : '?'}${cursorParameter}=${encodeURIComponent(page.next_cursor)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const body = await response.json(); const result = pageField ? body.data?.[pageField] : body.data; if (!response.ok || !Array.isArray(result?.items)) throw new Error('READ_FAILED');
      if (!controller.signal.aborted && current === generation.current) setState(previous => ({ path, page: { items: [...(previous.path === path ? previous.page?.items || [] : []), ...result.items], next_cursor: result.next_cursor } }));
    } catch { if (!controller.signal.aborted && current === generation.current) setState(previous => ({ ...previous, error: copy.failed })); }
    finally { controllers.current.delete(controller); if (current === generation.current) { paging.current = false; setLoadingMore(false); } }
  }
  return { items: page?.items, cursor: page?.next_cursor, error, loadingMore, loadMore, reload: () => { invalidate(); setState({ path }); setLoadingMore(false); setAttempt(value => value + 1); } };
}
export function PaymentReadState({ pending, error, reload, cursor, loadingMore, loadMore }: { pending: boolean; error?: string; reload: () => void; cursor?: string | null; loadingMore?: boolean; loadMore?: () => void }) {
  return <>{pending && !error && <p role="status">{copy.loading}</p>}{error && <p className={formStyles.error} role="alert">{error}</p>}<div className={styles.tools}><button className={formStyles.signout} type="button" onClick={reload}>{copy.refresh}</button>{cursor && <button className={formStyles.signout} type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? copy.loadingMore : copy.loadMore}</button>}</div></>;
}
export function State({ value }: { value: string }) { return <span className={styles.badge}>{copy.states[value] || value.replaceAll('_', ' ')}</span>; }
export function AmountField({ name, label = copy.amount, value, max, allowZero = false }: { name: string; label?: string; value?: number; max?: number; allowZero?: boolean }) {
  const id = useId(); return <div className={formStyles.field}><label htmlFor={id}>{label}</label><input id={id} name={name} type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={value === undefined ? '' : scaledIntegerInput(value, 2)} required aria-describedby={max === undefined ? undefined : `${id}-cap`} data-minor-min={allowZero ? 0 : 1} />{max !== undefined && <p id={`${id}-cap`} className={formStyles.hint}>{copy.refundable}: <bdi>{money(max)}</bdi></p>}</div>;
}
export function amountField(form: FormData, name: string, options: { max?: number; allowZero?: boolean } = {}) { const value = parseScaledIntegerInput(String(form.get(name) || ''), 2); if ((!options.allowZero && value === 0) || (options.max !== undefined && value > options.max)) throw new Error('AMOUNT_OUT_OF_RANGE'); return value; }
export function ChargeFacts({ charge }: { charge: ChargeSummary }) { return <div className={styles.summary}><h2>{charge.title}</h2><p>{charge.learner.display_name} · <State value={charge.commitment_state} /></p><dl className={styles.facts}>{[[copy.original, charge.original_minor], [copy.adjustments, charge.adjustments_minor], [copy.net, charge.net_minor], [copy.cash, charge.allocated_cash_minor], [copy.packageValue, charge.allocated_package_value_minor], [copy.balance, charge.balance_minor], [copy.reserved, charge.refund_reserved_minor], [copy.refunded, charge.refunded_minor], [copy.releasedCredit, charge.credit_released_minor]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === copy.balance ? styles.balance : undefined}><bdi>{money(value as number)}</bdi></dd></div>)}</dl>{charge.reconciliation_state !== 'clear' && <p className={styles.notice}>{copy.reasons.RECONCILIATION_REQUIRED} {copy.recovery}: <bdi>{money(charge.recovery_exposure_minor)}</bdi></p>}</div>; }
export function Confirmation({ result }: { result: ConfirmationResult }) { return <div className={styles.notice}><strong>{copy.outcome}: <State value={result.state} /></strong>{result.reason && <p>{copy.reasons[result.reason]}</p>}</div>; }
export function EvidenceSelect({ action, targetId, chargeId, value, onChange, name = 'file_id', label = copy.evidence }: { action?: string; targetId?: string | null; chargeId?: string; value: string; onChange: (value: string) => void; name?: string; label?: string }) {
  const path = chargeId ? `charges/${chargeId}/receipt-files` : action ? `payment-evidence?action=${action}${targetId ? `&target_id=${targetId}` : ''}` : null;
  const records = usePaymentList<SafeEvidence>(path);
  return <div><EvidenceUpload action={action || 'submit_receipt'} parentId={chargeId || targetId || null} onReady={id => { records.reload(); onChange(id); }} /><Select name={name} label={label} value={records.items?.some(row => row.file_id === value) ? value : ''} onChange={onChange}><option value="">{copy.choose}</option>{records.items?.map(row => <option key={row.file_id} value={row.file_id}>{row.detected_mime} · {new Date(row.created_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' })} · {row.byte_size} B · {row.file_id.slice(0, 8)}</option>)}</Select><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p className={styles.empty}>{fileCopy.empty}</p>}{records.items?.find(row => row.file_id === value)?.source_provenance === 'synthetic_development_metadata_no_bytes' && <p className={styles.meta}>{copy.evidenceDevelopment}</p>}</div>;
}
export function EvidenceMetadata({ evidence }: { evidence: SafeEvidence }) { return <>{evidence.source_provenance === 'synthetic_development_metadata_no_bytes' && <p className={styles.subtle}>{copy.evidenceDevelopment}</p>}{evidence.can_download && <p><a className={styles.link} href={`/api/v1/files/${evidence.file_id}/content`} download>{fileCopy.download}</a></p>}<dl className={styles.facts}><div><dt>{copy.evidenceState}</dt><dd><State value={evidence.scan_state} /></dd></div><div><dt>{copy.evidenceMetadata}</dt><dd>{evidence.detected_mime} · {evidence.byte_size} B</dd></div><div><dt>{copy.created}</dt><dd><CairoTimestamp value={evidence.created_at} /></dd></div></dl></>; }

export function usePaymentClock() { const [now, setNow] = useState(0); useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, []); return now; }
