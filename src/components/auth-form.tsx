'use client';

import { useRef, useState, type FormEvent } from 'react';
import { authCopy as copy } from '@/locales/auth';
import { useHydrated } from './use-hydrated';
import { customerReturnPath } from '@/modules/identity/return-path';
import styles from './auth.module.css';

type ApiResult = { data?: { redirect_to?: string; verification_required?: boolean }; code?: string; message?: string; request_id?: string };

function navigateAfterAuthentication(path: string) {
  // Authentication changes invalidate every cached account view. Start a fresh document
  // at the caller's fixed same-origin destination after the cookie response has committed.
  window.location.assign(new URL(path, window.location.origin).href);
}

export function AuthForm({ mode, unavailable = false, forbidden = false, returnTo }: { mode: 'login' | 'signup'; unavailable?: boolean; forbidden?: boolean; returnTo?: string }) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(unavailable ? copy.error.unavailable : forbidden ? copy.error.forbidden : '');
  const [reference, setReference] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const text = copy[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || pending) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const invalid = {
      email: !email || !emailRef.current?.validity.valid ? copy.error.invalidEmail : undefined,
      password: !password ? copy.error.requiredPassword : mode === 'signup' && password.length < 12 ? copy.error.shortPassword : undefined,
    };
    setFieldErrors(invalid);
    setError('');
    setReference('');
    if (invalid.email || invalid.password) {
      (invalid.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) {
        setError(result.message || copy.error.generic);
        setReference(result.request_id || '');
        return;
      }
      if (mode === 'signup' && result.data?.verification_required) {
        navigateAfterAuthentication('/auth/verify');
        return;
      }
      const destination = result.data?.redirect_to;
      if (destination && ['/learn', '/tutor', '/service', '/admin'].includes(destination)) {
        navigateAfterAuthentication(mode === 'login' ? customerReturnPath(returnTo) || destination : destination);
        return;
      }
      setError(copy.error.generic);
    } catch {
      setError(copy.error.network);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} method="post" action={`/api/auth/${mode}`} onSubmit={submit} noValidate aria-busy={!hydrated || pending}>
      <fieldset className={styles.formFields} disabled={!hydrated || pending}>
      <div className={styles.field}>
        <label htmlFor="email">{copy.email}</label>
        <input ref={emailRef} id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'email-error' : undefined} />
        {fieldErrors.email && <p className={styles.fieldError} id="email-error" role="alert">{fieldErrors.email}</p>}
      </div>
      <div className={styles.field}>
        <label htmlFor="password">{copy.password}</label>
        <div className={styles.passwordRow}>
          <input ref={passwordRef} id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 12 : undefined} maxLength={256} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'password-error' : mode === 'signup' ? 'password-hint' : undefined} />
          <button type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword}>{showPassword ? copy.hidePassword : copy.showPassword}</button>
        </div>
        {fieldErrors.password ? <p className={styles.fieldError} id="password-error" role="alert">{fieldErrors.password}</p> : mode === 'signup' && <p className={styles.hint} id="password-hint">{copy.passwordHint}</p>}
      </div>
      {error && <div className={styles.error} role="alert"><p>{error}</p>{reference && <p className={styles.hint}>{copy.error.reference}: <span className={styles.reference}>{reference}</span></p>}</div>}
      <button className={styles.primary} disabled={!hydrated || pending} type="submit">{pending ? text.pending : text.submit}</button>
      </fieldset>
    </form>
  );
}

export function SignOutButton() {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    if (!hydrated || pending) return;
    setPending(true);
    setError(false);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out failed');
      navigateAfterAuthentication('/login');
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return <div><button type="button" className={styles.signout} disabled={!hydrated || pending} onClick={signOut}>{pending ? copy.portal.signingOut : copy.portal.signout}</button>{error && <p className={styles.fieldError} role="alert">{copy.portal.signoutError}</p>}</div>;
}

export function SetPasswordForm({ staffInvitationId }: { staffInvitationId?: string }) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const confirmation = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || pending) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    if (password !== data.get('confirmation')) { setMismatch(true); confirmation.current?.focus(); return; }
    setMismatch(false); setError(''); setPending(true);
    try {
      const response = await fetch('/api/auth/password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) { const body = await response.json() as ApiResult; setError(body.message || copy.error.generic); return; }
      navigateAfterAuthentication(staffInvitationId ? `/learn?staff_invitation_id=${encodeURIComponent(staffInvitationId)}` : '/learn');
    } catch { setError(copy.error.network); }
    finally { setPending(false); }
  }
  return <form className={styles.form} method="post" action="/api/auth/password" onSubmit={submit} aria-busy={!hydrated || pending}>
    <fieldset className={styles.formFields} disabled={!hydrated || pending}>
    <div className={styles.field}><label htmlFor="new-password">{copy.password}</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required aria-describedby="new-password-hint" /><p id="new-password-hint" className={styles.hint}>{copy.passwordHint}</p></div>
    <div className={styles.field}><label htmlFor="confirm-password">{copy.passwordSetup.confirm}</label><input ref={confirmation} id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={256} required aria-invalid={mismatch} aria-describedby={mismatch ? 'confirmation-error' : undefined} />{mismatch && <p id="confirmation-error" className={styles.fieldError} role="alert">{copy.passwordSetup.mismatch}</p>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button type="submit" className={styles.primary} disabled={!hydrated || pending}>{pending ? copy.passwordSetup.pending : copy.passwordSetup.submit}</button>
    </fieldset>
  </form>;
}
