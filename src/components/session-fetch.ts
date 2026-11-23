export const changeKey = 'git-tutor-session-change';

export function documentSession() {
  return document.documentElement.dataset.sessionView || 'signed-out';
}

export function notifySessionChange() {
  try { localStorage.setItem(changeKey, crypto.randomUUID()); } catch { /* Focus checks still work without storage. */ }
}

export function discardOtherSessionRetries(current?: string) {
  try {
    for (const key of Object.keys(sessionStorage)) {
      const prefix = /^git-tutor-(?:calendar|command|upload):/.exec(key)?.[0];
      if (prefix && (!current || !key.startsWith(prefix + current + ':'))) sessionStorage.removeItem(key);
    }
  } catch { /* Private browsing may disable tab storage. */ }
}

export function closeStaleView() {
  discardOtherSessionRetries();
  document.documentElement.style.visibility = 'hidden';
  window.location.replace('/auth/session-ended');
}

/** Bind an app request to the page that initiated it, including requests from old tabs. */
export async function sessionFetch(path: string, init?: RequestInit) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) throw new Error('Invalid application route');
  const headers = new Headers(init?.headers);
  headers.set('x-git-tutor-view', documentSession());
  const response = await fetch(url, { ...init, headers });
  if (response.headers.get('x-git-tutor-session-changed') === '1') {
    closeStaleView();
    throw new Error('Session changed');
  }
  return response;
}
