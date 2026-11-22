'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useHydrated } from './use-hydrated';

function parentPage(path: string, workspaceHome?: string) {
  const [, portal, section, area, detail] = path.split('/');
  if (['admin', 'service', 'tutor', 'learn'].includes(portal)) {
    if (!section) return '/';
    if (!area) return '/' + portal;
    if (detail && portal === 'admin' && section === 'payments' && area === 'reviews') return '/admin/payments/reviews';
    return '/' + portal + '/' + section;
  }
  if (portal === 'tutors') return '/subjects';
  if (portal === 'offers' && section) return '/offers';
  if (path === '/auth/recover' || path === '/signup') return '/login';
  return workspaceHome || '/';
}

// Browsers without accessible navigation history use the same link as a direct visit.
function hasPreviousSitePage() {
  const navigation = (window as Window & { navigation?: {
    currentEntry: { index: number } | null;
    entries(): { url: string | null }[];
  } }).navigation;
  const url = navigation?.entries()[(navigation.currentEntry?.index ?? 0) - 1]?.url;
  if (!url) return false;
  const previous = new URL(url);
  return previous.origin === window.location.origin && previous.pathname !== window.location.pathname &&
    /^\/(?:$|(?:admin|service|tutor|learn|subjects|offers|tutors|support|apply-to-teach)(?:\/|$))/.test(previous.pathname);
}

export function SiteBackLink({ arabic, workspaceHome }: { arabic: boolean; workspaceHome?: string }) {
  const path = usePathname() || '/';
  const hydrated = useHydrated();
  if (path === '/' && !workspaceHome && !(hydrated && hasPreviousSitePage())) return null;
  return <Link className="site-back" href={parentPage(path, workspaceHome)} prefetch={false} onNavigate={event => {
    if (!/^\/(?:login|signup|auth)(?:\/|$)/.test(path) && hasPreviousSitePage()) {
      event.preventDefault();
      window.history.back();
    }
  }}><span aria-hidden="true">{arabic ? '→' : '←'}</span>{arabic ? 'رجوع' : 'Back'}</Link>;
}
