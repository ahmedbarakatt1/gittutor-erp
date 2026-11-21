'use client';

import { useStaffText } from './ar-staff-label';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { authCopy } from '@/locales/auth';
import styles from './portal-navigation.module.css';

export type NavigationGroup = { label: string; links: { href: string; label: string }[] };

export function PortalNavigation({ groups, workspace, activePath }: {
  groups: NavigationGroup[]; workspace: string; activePath: string;
}) {
  const t = useStaffText();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = groups.flatMap(group => group.links).find(link => link.href === activePath);
  return <nav className={styles.nav} aria-label={t(workspace)} onKeyDown={event => {
    if (event.key === 'Escape' && open && trigger.current?.offsetWidth) {
      setOpen(false);
      trigger.current.focus();
    }
  }}>
    <button type="button" className={styles.toggle} ref={trigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className={styles.menuLabel}>{t(authCopy.navigation.menu)}</span>
      <span className={styles.location}>{t(active?.label || workspace)}</span>
      <span className={styles.chevron} aria-hidden="true" />
    </button>
    <div id={id} className={styles.groups} data-open={open}>
      {groups.map(group => <div key={group.label} className={styles.group}>
        <p className={styles.groupTitle}>{t(group.label)}</p>
        <ul aria-label={t(group.label)}>{group.links.map(link =>
          <li key={link.href}><Link href={link.href} aria-current={link.href === activePath ? 'page' : undefined}
            onClick={() => setOpen(false)}>{t(link.label)}</Link></li>)}</ul>
      </div>)}
    </div>
  </nav>;
}
