'use client';
import { useEffect } from 'react';
import { changeKey, closeStaleView, discardOtherSessionRetries, documentSession, notifySessionChange } from './session-fetch';
import { accountScope } from '@/modules/identity/account-scope';

export function SessionGuard() {
  useEffect(() => {
    if (location.pathname === '/auth/session-ended') return;
    discardOtherSessionRetries(documentSession());
    // Covers full-page email callbacks as well as ordinary password sign-in.
    try {
      if (localStorage.getItem('git-tutor-last-view') !== documentSession()) {
        localStorage.setItem('git-tutor-last-view', documentSession());
        notifySessionChange();
      }
    } catch { /* Session comparison on visibility/resume is independent of storage. */ }
    let sequence = 0;
    let stopped = false;
    const hide = () => { if (documentSession() !== 'signed-out') document.documentElement.style.visibility = 'hidden'; };
    async function check() {
      const current = ++sequence;
      const view = documentSession();
      try {
        // Only the latest check for the visible document may initiate navigation.
        const response = await fetch('/api/v1/me', { headers: { 'x-git-tutor-view': view }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (stopped || sequence !== current || documentSession() !== view) return;
        if (!response.ok && !(view === 'signed-out' && response.status === 401)) return closeStaleView();
        const scope = document.querySelector<HTMLElement>('[data-account-scope]')?.dataset.accountScope;
        if (scope && response.ok) {
          const { data } = await response.json();
          if (stopped || sequence !== current) return;
          if (scope !== accountScope(data)) return closeStaleView();
        }
        if (!document.hidden) document.documentElement.style.removeProperty('visibility');
      } catch {
        if (!stopped && sequence === current && view !== 'signed-out') closeStaleView();
      }
    }
    const suspend = () => { ++sequence; hide(); };
    const visibility = () => {
      if (document.hidden) suspend();
      else void check();
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { hide(); void check(); } };
    const changed = (event: StorageEvent) => { if (event.key === changeKey) { hide(); void check(); } };
    const focus = () => { if (!document.hidden && documentSession() !== 'signed-out') { hide(); void check(); } };
    const timer = window.setInterval(() => { if (!document.hidden && documentSession() !== 'signed-out') void check(); }, 60000);
    window.addEventListener('storage', changed);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', restore);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('storage', changed);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return null;
}
