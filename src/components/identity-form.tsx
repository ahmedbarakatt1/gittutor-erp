'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { identityCopy as copy } from '@/locales/auth';
import { useHydrated } from './use-hydrated';
import styles from './auth.module.css';

type Result = { data?: Record<string, unknown>; code?: string; message?: string; request_id?: string };

export function IdentityForm({ children, action, payload, submitLabel, successMessage, disabled = false, resettable = true, onSaved, onPendingChange }: {
  children: ReactNode;
  action: string | ((data: FormData) => string);
  payload: (data: FormData) => Record<string, unknown>;
  submitLabel: string;
  successMessage: string;
  disabled?: boolean;
  resettable?: boolean;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const hydrated = useHydrated();
  const operation = useRef<{ key: string; signature: string; storageKey: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [reset, setReset] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || pending || disabled || result) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    let body: Record<string, unknown>;
    let path: string;
    try {
      const data = new FormData(form);
      body = payload(data);
      path = typeof action === 'function' ? action(data) : action;
    } catch { setError(copy.invalid); return; }
    const signature = `${path}:${JSON.stringify(body)}`;
    setPending(true);
    onPendingChange?.(true);
    setError('');
    setRequestId('');
    try {
      if (!operation.current || operation.current.signature !== signature) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
        const storageKey = `git-tutor-command:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
        let key: string = crypto.randomUUID();
        // Keep only a digest and random key in tab storage, never form fields or invitation tokens.
        // An interrupted response can then be retried after a reload with the same logical key.
        try {
          const saved = sessionStorage.getItem(storageKey);
          if (saved && /^[0-9a-f-]{36}$/.test(saved)) key = saved;
          sessionStorage.setItem(storageKey, key);
        } catch { /* In-memory retry identity still works when browser storage is unavailable. */ }
        operation.current = { key, signature, storageKey };
      }
      const response = await fetch(`/api/v1/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.current.key }, body: JSON.stringify(body) });
      const responseBody = await response.json() as Result;
      if (!response.ok) { setError(responseBody.message || copy.network); setRequestId(responseBody.request_id || ''); return; }
      setResult(responseBody.data || {});
      onSaved?.();
    } catch { setError(copy.network); }
    finally { setPending(false); onPendingChange?.(false); }
  }

  return <form ref={formRef} className={styles.form} method="post" onSubmit={submit} aria-busy={!hydrated || pending} aria-label={submitLabel}>
    <fieldset key={reset} className={styles.formFields} disabled={!hydrated || pending || Boolean(result)}>{children}</fieldset>
    {error && <div className={styles.error} role="alert"><p>{error}</p>{requestId && <p className={styles.hint}>{copy.requestReference}: <span className={styles.reference}>{requestId}</span></p>}</div>}
    {result ? <div className={styles.saved} role="status"><p>{successMessage}</p><dl>{Object.entries(copy.recordLabels).filter(([key]) => typeof result[key] === 'string' || typeof result[key] === 'number').map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{String(result[key])}</dd></div>)}</dl>{resettable && <button type="button" className={styles.signout} onClick={() => {
      if (operation.current) { try { sessionStorage.removeItem(operation.current.storageKey); } catch { /* Storage may be disabled. */ } }
      setResult(null); operation.current = null; formRef.current?.reset(); setReset(value => value + 1);
    }}>{copy.nextRequest}</button>}</div> : <button className={styles.primary} type="submit" disabled={!hydrated || pending || disabled}>{pending ? copy.pending : submitLabel}</button>}
  </form>;
}

export function TextField({ name, label, hint, type = 'text', defaultValue, maxLength, min, pattern }: { name: string; label: string; hint?: string; type?: string; defaultValue?: string | number; maxLength?: number; min?: string | number; pattern?: string }) {
  const id = useId();
  return <div className={styles.field}><label htmlFor={id}>{label}</label><input id={id} name={name} type={type} required defaultValue={defaultValue} maxLength={maxLength} min={min} pattern={pattern} aria-describedby={hint ? `${id}-hint` : undefined} />{hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}</div>;
}

export const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
