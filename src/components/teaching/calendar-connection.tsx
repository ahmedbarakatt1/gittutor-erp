'use client';

import { useRef, useState } from 'react';
import type { CalendarConnection } from '@/modules/teaching/meetings';
import { meetingCopy as copy } from '@/locales/meetings';
import { IdentityForm } from '../identity-form';
import { CairoTimestamp } from '../booking/shared';
import { usePaymentRecord } from '../payments/shared';
import styles from './calendar-connection.module.css';

type ConnectAction = { action: 'add' } | { action: 'reconnect'; connection_id: string; expected_version: number };

export function CalendarConnectionPanel({ provider, outcome, verifyGoogleRooms }: { provider: 'fake' | 'google'; outcome?: string; verifyGoogleRooms: boolean }) {
  const records = usePaymentRecord<CalendarConnection[]>('calendar/connections', true);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const operation = useRef<{ signature: string; key: string } | null>(null);

  async function connect(action: ConnectAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setFeedback('');
    const signature = JSON.stringify(verifyGoogleRooms ? { ...action, verify_room: true } : action);
    const storageKey = `git-tutor-calendar:${provider}:${signature}`;
    try {
      if (operation.current?.signature !== signature) {
        let key: string = crypto.randomUUID();
        try {
          const saved = sessionStorage.getItem(storageKey);
          if (saved && /^[0-9a-f-]{36}$/i.test(saved)) key = saved;
          sessionStorage.setItem(storageKey, key);
        } catch { /* Retry within this page when browser storage is disabled. */ }
        operation.current = { key, signature };
      }
      const response = await fetch('/api/calendar/connect', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.current.key },
        body: signature,
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) records.reload();
        throw new Error(body.error?.message || copy.connectFailed);
      }
      const simulated = body.data?.mode === 'fake' && body.data.authorization_url === '/admin/integrations';
      const url = simulated ? null : new URL(body.data.authorization_url);
      if (!simulated && (body.data.mode !== 'google' || url?.origin !== 'https://accounts.google.com' ||
        url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash)) throw new Error(copy.connectFailed);
      try { sessionStorage.removeItem(storageKey); } catch { /* The request has already completed. */ }
      operation.current = null;
      if (url) window.location.assign(url.href);
      else { setFeedback(copy.connectedFake); records.reload(); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.connectFailed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const rows = records.data;
  const hasProvider = rows?.some(row => row.mode === provider && row.connection_id);
  const addLabel = verifyGoogleRooms ? 'Add and verify Google account' :
    provider === 'google' ? 'Add Google account' : hasProvider ? 'Add simulated organizer' : copy.connectFake;
  const callbackMessage = typeof outcome === 'string' && Object.hasOwn(copy.oauthResults, outcome) ? copy.oauthResults[outcome] : undefined;
  return <section className={styles.panel} aria-labelledby="organizers-heading">
    <header className={styles.header}>
      <div><h2 id="organizers-heading">Meet organizers</h2>
        <p>Each organizer can host one session at a time. Connect another account to run lessons in parallel.</p>
        {verifyGoogleRooms && <p>Verification creates and removes a private test event on the selected calendar. It has no guests. Only verified accounts can host lessons.</p>}</div>
      <button type="button" className={styles.add} disabled={!rows || pending} onClick={() => void connect({ action: 'add' })}>
        <span aria-hidden="true">+</span> {addLabel}
      </button>
    </header>
    {callbackMessage && <p role={outcome === 'connected' || outcome === 'verified' ? 'status' : 'alert'}>{callbackMessage}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {error && <p role="alert">{error}</p>}
    {records.error && <p role="alert">{records.error} <button className={styles.secondary} type="button" onClick={records.reload}>Try again</button></p>}
    {!rows && !records.error && <p role="status">Loading organizer accounts…</p>}
    {rows && <>
      <div className={styles.summary}>
        <span>{rows.length} organizer {rows.length === 1 ? 'account' : 'accounts'}</span>
        <button className={styles.secondary} type="button" onClick={records.reload}>Refresh accounts</button>
      </div>
      {rows.length === 0 ? <p>Connect the first organizer to prepare session rooms.</p> :
        <ul className={styles.list}>{rows.map(row => {
          const id = row.connection_id;
          if (!id) return null;
          const canReconnect = row.mode === provider;
          const title = row.organizer_masked_email || (row.mode === 'fake' ? 'Practice organizer' : 'Google organizer');
          const practice = row.mode === 'fake' || row.state === 'preview_connected';
          const ambiguous = !row.organizer_masked_email || rows.some(other =>
            other.connection_id !== id && other.organizer_masked_email === row.organizer_masked_email);
          return <li key={id} id={`organizer-${id}`} className={styles.account}>
            <div className={styles.accountBody}>
              <div className={styles.accountName}><strong>{title}{ambiguous && <small> · {id.slice(-6)}</small>}</strong><span className={styles.state}>{copy.states[row.state]}</span></div>
              <p>{row.mode === 'fake' ? 'Simulated rooms' : practice ? 'Designated test bookings' : 'Google Meet'} · {copy.states[row.integration_state]}</p>
              {row.last_verified_at && <small>Last verified <CairoTimestamp value={row.last_verified_at} /></small>}
            </div>
            <details className={styles.manage}><summary>Manage<span className={styles.srOnly}> {title}</span></summary>
              <div className={styles.actions}>
                {canReconnect && <button type="button" disabled={pending} className={styles.secondary}
                  onClick={() => void connect({ action: 'reconnect', connection_id: id, expected_version: row.version })}>
                  {verifyGoogleRooms && row.mode === 'google' ? 'Reconnect and verify Google Meet' : row.mode === 'google' ? copy.reconnect : 'Reconnect simulated calendar'}
                </button>}
                {row.state !== 'revoked' && <IdentityForm key={row.version} action="calendar/connection/revoke"
                  submitLabel={copy.revoke} successMessage={copy.revoked} resettable={false} onSaved={records.reload}
                  payload={() => ({ connection_id: id, expected_version: row.version })}>
                  <p>Revoking this account can interrupt access to its assigned rooms.</p>
                </IdentityForm>}
                {!canReconnect && row.state === 'revoked' && <p>This account belongs to a different provider mode.</p>}
              </div>
            </details>
          </li>;
        })}</ul>}
    </>}
  </section>;
}
