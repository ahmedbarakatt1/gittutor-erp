'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { formatMinorUnits } from '@/modules/shared/format';
import { bookingCopy as copy } from '@/locales/booking';
import { resolveCairoLocalTime } from '@/modules/booking/scheduling';
import styles from './booking.module.css';
import formStyles from '../auth.module.css';

export function useBookingRecord<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data?: T; failed?: boolean }>({ path });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    fetch(`/api/v1/${path}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('READ_FAILED');
      const body = await response.json(); if (!controller.signal.aborted) setState({ path, data: body.data });
    }).catch(() => { if (!controller.signal.aborted) setState({ path, failed: true }); });
    return () => controller.abort();
  }, [path, attempt]);
  return { data: state.path === path ? state.data : undefined, failed: state.path === path && Boolean(state.failed), reload: () => { setState({ path }); setAttempt(value => value + 1); } };
}
export function ReadState({ pending, failed, reload, cursor, loadMore, loadingMore }: { pending: boolean; failed: boolean; reload: () => void; cursor?: string | null; loadMore?: () => void; loadingMore?: boolean }) {
  return <>{pending && !failed && <p role="status">{copy.loading}</p>}{failed && <p className={formStyles.error} role="alert">{copy.failed}</p>}<div className={styles.tools}><button type="button" className={formStyles.signout} onClick={reload}>{copy.refresh}</button>{cursor && <button type="button" className={formStyles.signout} disabled={loadingMore} onClick={loadMore}>{loadingMore ? copy.loadingMore : copy.more}</button>}</div></>;
}
export function Select({ name, label, value, onChange, children, required = true }: { name: string; label: string; value: string; onChange: (value: string) => void; children: ReactNode; required?: boolean }) {
  const id = useId(); return <div className={formStyles.field}><label htmlFor={id}>{label}</label><select id={id} name={name} value={value} onChange={event => onChange(event.target.value)} required={required}>{children}</select></div>;
}
export function Check({ name, label }: { name: string; label: string }) { return <label className={styles.choice}><input type="checkbox" name={name} required />{label}</label>; }
export function money(value: number, currency = 'EGP') { return formatMinorUnits(value, currency); }
export function cairoDate(value: string) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
export function cairoTime(value: string) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)); }
export function SessionTime({ start, end }: { start: string; end: string }) { return <bdi dir="ltr" className={styles.date}><time dateTime={start}>{cairoDate(start)} · {cairoTime(start)}</time>–<time dateTime={end}>{cairoTime(end)}</time><span className={styles.meta}> {copy.timezone}</span></bdi>; }
export function CairoTimestamp({ value }: { value: string }) { return <bdi dir="ltr">{cairoDate(value)} · {cairoTime(value)} {copy.timezone}</bdi>; }
export function CairoInput({ name, label, onChange, initial = '' }: { name: string; label: string; onChange?: (value: string) => void; initial?: string }) {
  const id = useId(); const [local, setLocal] = useState(initial); const [choice, setChoice] = useState('');
  function candidatesFor(value: string) { try { return resolveCairoLocalTime(value); } catch { return []; } }
  const candidates = local ? candidatesFor(local) : [];
  const instant = candidates.length === 1 ? candidates[0].instant : candidates.find(item => item.instant === choice)?.instant || '';
  function update(value: string) { setLocal(value); setChoice(''); const values = candidatesFor(value); onChange?.(values.length === 1 ? values[0].instant : ''); }
  return <div className={formStyles.field}><label htmlFor={id}>{label}</label><input id={id} className={styles.dateInput} type="datetime-local" value={local} onChange={event => update(event.target.value)} required aria-describedby={`${id}-hint`} /><input type="hidden" name={name} value={instant} /><p className={formStyles.hint} id={`${id}-hint`}>{copy.allTimes}</p>{local && !candidates.length && <p className={formStyles.fieldError} role="alert">{copy.localSkipped}</p>}{candidates.length > 1 && <><p>{copy.localAmbiguous}</p><label htmlFor={`${id}-offset`}>{copy.offset}</label><select id={`${id}-offset`} required value={choice} onChange={event => { setChoice(event.target.value); onChange?.(event.target.value); }}><option value="">{copy.chooseOffset}</option>{candidates.map(item => <option key={item.instant} value={item.instant}>{`UTC${item.offset_minutes >= 0 ? '+' : '-'}${Math.floor(Math.abs(item.offset_minutes) / 60).toString().padStart(2, '0')}:${(Math.abs(item.offset_minutes) % 60).toString().padStart(2, '0')}`}</option>)}</select></>}</div>;
}
export function instantField(form: FormData, name: string) { const value = String(form.get(name) || ''); if (!value || !Number.isFinite(Date.parse(value))) throw new Error('INVALID_CAIRO_TIME'); return value; }
export function moneyField(form: FormData, name: string) { const text = String(form.get(name) || ''); if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('INVALID_AMOUNT'); const [whole, fraction = ''] = text.split('.'); const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0')); if (!Number.isSafeInteger(value)) throw new Error('INVALID_AMOUNT'); return value; }
