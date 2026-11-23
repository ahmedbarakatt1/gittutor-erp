'use client';
import { sessionFetch } from '@/components/session-fetch';

import { useEffect, useState } from 'react';
import type { MeetingView, MeetingAccess } from '@/modules/teaching/meetings';
import { meetingCopy as copy } from '@/locales/meetings';
import { IdentityForm, TextField } from '../identity-form';
import { SessionTime } from '../booking/shared';
import styles from './meeting-panel.module.css';
import formStyles from '../auth.module.css';
import { meetingCopy as arabicMeetingCopy } from '@/locales/ar-transaction/meetings';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicMeetingCopy },
};


export function MeetingPanel({ occurrenceId, learnerId, view = 'customer', displayedSchedule }: { occurrenceId: string; learnerId?: string; view?: 'customer' | 'tutor' | 'admin'; displayedSchedule?: { start: string; end: string } }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const query = `view=${view}${learnerId ? `&learner_id=${learnerId}` : ''}`, path = `occurrences/${occurrenceId}/meeting?${query}`;
  const [record, setRecord] = useState<{ path: string; data: MeetingView; received: number } | null>(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0), [clock, setClock] = useState(0), [joining, setJoining] = useState(false), [joinError, setJoinError] = useState(''), [preview, setPreview] = useState(false);
  const data = record?.path === path ? record.data : undefined;
  useEffect(() => { const timer = setInterval(() => setClock(performance.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try { const response = await sessionFetch(`/api/v1/${path}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }); const body = await response.json(); if (!response.ok || body.data?.occurrence_id !== occurrenceId) throw new Error('MEETING_UNAVAILABLE'); if (!controller.signal.aborted) { const received = performance.now(); setRecord({ path, data: body.data, received }); setClock(received); setFailed(false); timer = setTimeout(load, 15000); } }
      catch { if (!controller.signal.aborted) { setFailed(true); setRecord(null); } }
    }
    void load(); return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [path, occurrenceId, attempt]);
  const now = data && record ? Date.parse(data.server_now) + Math.max(0, clock - record.received) : 0;
  const remaining = data ? Math.max(0, Math.ceil((Date.parse(data.start_at) - now) / 60000)) : 0;
  const ended = Boolean(data && now >= Date.parse(data.end_at));
  function refresh() { setPreview(false); setJoinError(''); setAttempt(value => value + 1); }
  async function join() {
    if (!data?.can_join || ended || joining) return;
    setJoining(true); setJoinError(''); setPreview(false);
    try {
      const response = await sessionFetch(`/api/v1/occurrences/${occurrenceId}/meeting/access?${query}`, { cache: 'no-store', credentials: 'same-origin' }); const body = await response.json();
      if (!response.ok) throw new Error(body.message || copy.failed);
      const access = body.data as MeetingAccess; if (access.occurrence_id !== occurrenceId) throw new Error(copy.failed);
      if (access.integration_state === 'simulated') { setPreview(true); return; }
      const url = new URL(access.join_url); if (access.integration_state !== 'verified' || url.protocol !== 'https:' || url.hostname !== 'meet.google.com' || url.username || url.password || url.port) throw new Error(copy.verification);
      window.location.assign(url.href);
    } catch (error) { setJoinError(error instanceof Error ? error.message : copy.failed); setAttempt(value => value + 1); }
    finally { setJoining(false); }
  }
  return <section className={styles.room} aria-label={copy.title}>
    <div className={styles.heading}>
      <h2><svg className={styles.camera} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <rect x="3" y="6.5" width="12" height="11" rx="2.5" /><path d="m15 10 6-3v10l-6-3" />
      </svg>{copy.title}</h2>
      <button type="button" className={styles.refresh} aria-label={copy.refresh} onClick={refresh}>{copy.refreshShort}</button>
    </div>
    {!data && !failed && <p role="status">{copy.loading}</p>}
    {failed && <p role="alert" className={formStyles.error}>{copy.failed}</p>}
    {data && <>
      <div className={styles.body}>
        <div className={styles.info}>
          <p className={styles.readiness}><span className={styles.indicator} data-ready={data.can_join && !ended} aria-hidden="true" />{copy.status[data.meeting_status]}</p>
          {(!displayedSchedule || displayedSchedule.start !== data.start_at || displayedSchedule.end !== data.end_at) && <SessionTime start={data.start_at} end={data.end_at} />}
          <p role="timer" aria-live="off">{ended ? copy.ended : remaining > 0
            ? `${copy.starts} ${copy.countdown(Math.floor(remaining / 1440), Math.floor(remaining % 1440 / 60), remaining % 60)}` : copy.scheduledNow}</p>
          {data.reason && data.reason !== 'SESSION_ENDED' && <p>{copy.reasons[data.reason]}</p>}
        </div>
        <div className={styles.action}>
          <button type="button" className={formStyles.primary} onClick={() => void join()} disabled={!data.can_join || ended || joining || failed}>
            {joining ? copy.joining : data.integration_state === 'simulated' ? copy.preview : copy.join}
          </button>
          <p>{data.integration_state === 'simulated' ? copy.simulated : data.integration_state === 'verified' ? copy.live : data.reason !== 'LIVE_VERIFICATION_REQUIRED' ? copy.verification : null}</p>
        </div>
      </div>
      {joinError && <p role="alert" className={formStyles.error}>{joinError}</p>}
      {preview && <section className={styles.preview} aria-label={copy.previewTitle}>
        <h3>{copy.previewTitle}</h3><p role="status">{copy.previewDescription}</p>
        <button type="button" className={formStyles.signout} onClick={() => setPreview(false)}>{copy.close}</button>
      </section>}
      {view === 'admin' && <details className={styles.manage}><summary>{copy.manage}</summary>
        <IdentityForm action={`occurrences/${occurrenceId}/meeting/retry`} submitLabel={copy.retry} successMessage={copy.retried}
          resettable={false} payload={() => ({ expected_version: data.occurrence_version })} onSaved={refresh}><p>{copy.reasons.PROVISIONING}</p></IdentityForm>
        <details><summary>{copy.replace}</summary>
          <IdentityForm action={`occurrences/${occurrenceId}/meeting/replace`} submitLabel={copy.replace} successMessage={copy.replaced}
            resettable={false} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: data.occurrence_version })} onSaved={refresh}>
            <p>{copy.replaceDescription}</p><TextField name="reason" label={copy.replaceReason} maxLength={2000} />
          </IdentityForm>
        </details>
      </details>}
    </>}
  </section>;
}
