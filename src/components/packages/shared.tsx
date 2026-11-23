'use client';
import { sessionFetch } from '@/components/session-fetch';

import { useEffect, useId, useState } from 'react';
import { formatCreditQuanta, scaledIntegerInput } from '@/modules/shared/format';
import { packageCopy as copy } from '@/locales/packages';
import styles from './packages.module.css';
import formStyles from '../auth.module.css';
import { packageCopy as arabicPackageCopy } from '@/locales/ar-transaction/packages';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPackageCopy },
};


export function credits(value: number, language: 'ar' | 'en' = 'en') {
  if (language === 'ar') return `${formatCreditQuanta(value, 'ar-EG')} رصيد دراسي`;
  return `${formatCreditQuanta(value)} ${value === 1000 ? 'credit' : 'credits'}`;
}
export function creditField(form: FormData, name: string) {
  const raw = String(form.get(name) || ''); if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw new Error('INVALID_CREDIT_QUANTITY');
  const [whole, fraction = ''] = raw.split('.'); const quanta = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(quanta) || quanta < 0) throw new Error('INVALID_CREDIT_QUANTITY'); return quanta;
}
export function CreditField({ name, label, defaultValue, max, allowZero = false }: { name: string; label: string; defaultValue?: number; max?: number; allowZero?: boolean }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const id = useId(); return <div className={formStyles.field}><label htmlFor={id}>{label}</label><input id={id} name={name} type="number" inputMode="decimal" step="0.001" min={allowZero ? 0 : .001} max={max === undefined ? undefined : scaledIntegerInput(max, 3)} defaultValue={defaultValue === undefined ? undefined : scaledIntegerInput(defaultValue, 3)} aria-describedby={`${id}-hint`} required /><p id={`${id}-hint`} className={formStyles.hint}>{copy.quantityHint}</p></div>;
}
export function usePackageRecord<T>(path: string | null) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [state, setState] = useState<{ path: string | null; data?: T; error?: string }>({ path }); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    sessionFetch(`/api/v1/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (controller.signal.aborted) return;
      if (!response.ok) { setState({ path, error: ['FORBIDDEN', 'PERMISSION_DENIED', 'CONSENT_REQUIRED'].includes(body.code) || response.status === 403 ? copy.permission : copy.failed }); return; }
      setState({ path, data: body.data });
    }).catch(() => { if (!controller.signal.aborted) setState({ path, error: copy.failed }); });
    return () => controller.abort();
  }, [path, attempt, copy.failed, copy.permission]);
  return { data: state.path === path ? state.data : undefined, error: state.path === path ? state.error : undefined, reload: () => { setState({ path }); setAttempt(value => value + 1); } };
}
export function PackageReadState({ pending, failed, error, reload, cursor, loadingMore, loadMore }: { pending: boolean; failed?: boolean; error?: string; reload: () => void; cursor?: string | null; loadingMore?: boolean; loadMore?: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  return <>{pending && !failed && !error && <p role="status">{copy.loading}</p>}{(failed || error) && <p role="alert" className={formStyles.error}>{error || copy.failed}</p>}<div className={styles.tools}><button type="button" className={formStyles.signout} onClick={reload}>{copy.refresh}</button>{cursor && <button type="button" className={formStyles.signout} disabled={loadingMore} onClick={loadMore}>{loadingMore ? copy.loadingMore : copy.more}</button>}</div></>;
}
