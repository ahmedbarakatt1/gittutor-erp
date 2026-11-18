'use client';

import { useRef, useState } from 'react';
import type { CalendarConnection } from '@/modules/teaching/meetings';
import { meetingCopy as copy } from '@/locales/meetings';
import { IdentityForm } from '../identity-form';
import { CairoTimestamp } from '../booking/shared';
import { PaymentReadState, usePaymentRecord } from '../payments/shared';
import styles from '../files/files.module.css';
import formStyles from '../auth.module.css';

export function CalendarConnectionPanel({ provider }: { provider: 'fake' | 'google' }) {
  const record = usePaymentRecord<CalendarConnection>('calendar/connection'), data = record.data;
  const operation = useRef<{ version: number; key: string } | null>(null), [pending, setPending] = useState(false), [error, setError] = useState(''), [connected, setConnected] = useState(false);
  async function connect() {
    if (!data || pending) return;
    setPending(true); setError('');
    try {
      if (provider === 'google') operation.current = { version: data.version, key: crypto.randomUUID() };
      if (operation.current?.version !== data.version) { const storageKey = `git-tutor-calendar-connect:${data.version}`; let key: string = crypto.randomUUID(); try { const saved = sessionStorage.getItem(storageKey); if (saved && /^[0-9a-f-]{36}$/.test(saved)) key = saved; sessionStorage.setItem(storageKey, key); } catch { /* Keep in-memory retry. */ } operation.current = { version: data.version, key }; }
      const response = await fetch('/api/calendar/connect', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.current.key }, body: '{}' }); const body = await response.json(); if (!response.ok) throw new Error(body.message || copy.connectFailed);
      if (body.data?.mode === 'fake' && body.data.authorization_url === '/admin/integrations') { setConnected(true); record.reload(); return; }
      const url = new URL(body.data?.authorization_url); if (body.data.mode !== 'google' || url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) throw new Error(copy.connectFailed);
      window.location.assign(url.href);
    } catch (failure) { setError(failure instanceof Error ? failure.message : copy.connectFailed); }
    finally { setPending(false); }
  }
  return <section className={styles.section}>
    <h2>{copy.integrationTitle}</h2>
    <PaymentReadState pending={!data} {...record} />
    {data && <>
      <dl>
        <dt>{copy.mode}</dt><dd>{data.mode === 'fake' ? copy.fakeMode : copy.googleMode}</dd>
        <dt>{copy.connectionState}</dt>
        <dd>{copy.states[data.state]} · {data.state === 'preview_connected' && data.integration_state === 'verified' ? copy.privateMeetVerified : copy.states[data.integration_state]}</dd>
        {data.organizer_masked_email && <><dt>{copy.organizer}</dt><dd>{data.organizer_masked_email}</dd></>}
        <dt>{copy.lastVerified}</dt><dd>{data.last_verified_at ? <CairoTimestamp value={data.last_verified_at} /> : copy.neverVerified}</dd>
      </dl>
      {data.mode === 'fake' && <p className={styles.notice}>{copy.simulated}</p>}
      {data.state === 'preview_connected' && <p>{copy.practiceRooms}</p>}
      {data.integration_state === 'verification_required' && <p>{copy.verification}</p>}
      {error && <p role="alert" className={formStyles.error}>{error}</p>}
      {connected && <p role="status">{copy.connectedFake}</p>}
      <button type="button" className={formStyles.primary} disabled={pending} onClick={() => void connect()}>
        {provider === 'fake' ? copy.connectFake : data.mode === 'fake' || data.state === 'not_connected' ? copy.connect : copy.reconnect}
      </button>
      {data.connection_id && data.state !== 'revoked' && <IdentityForm
        action="calendar/connection/revoke" submitLabel={copy.revoke} successMessage={copy.revoked}
        resettable={false} onSaved={record.reload} payload={() => ({ connection_id: data.connection_id, expected_version: data.version })}
      >
        <p>{copy.revokeHint}</p>
      </IdentityForm>}
    </>}
  </section>;
}
