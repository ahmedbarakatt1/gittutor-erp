import type { ReactNode } from 'react';
import { publicContact as contact } from '@/locales/contact';
import styles from './public-contact.module.css';

function ContactIcon({ name }: { name: 'whatsapp' | 'instagram' | 'tiktok' | 'telephone' }) {
  return <svg className={styles.icon} width="20" height="20" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <use href={`/brand/contact-icons.svg#${name}`} />
  </svg>;
}

export function PublicContactLinks() {
  return <address className={styles.links} role="group" aria-label={contact.label}>
    <a href={contact.whatsappHref}><ContactIcon name="whatsapp" />{contact.whatsapp}</a>
    <a href={contact.instagramHref}><ContactIcon name="instagram" />{contact.instagram}</a>
    <a href={contact.tiktokHref}><ContactIcon name="tiktok" />{contact.tiktok}</a>
    <a href={contact.phoneHref}><ContactIcon name="telephone" />
      <span><span className={styles.call}>{contact.call}</span> <bdi dir="ltr">{contact.phoneDisplay}</bdi></span>
    </a>
  </address>;
}

export function WhatsAppContactAction({ children }: { children: ReactNode }) {
  return <a className={styles.action} href={contact.whatsappHref}>
    <ContactIcon name="whatsapp" /><span>{children}</span>
  </a>;
}

export function CourseHelp() {
  return <aside className={styles.help} aria-labelledby="course-help-title">
    <div><h2 id="course-help-title">{contact.courseHelpTitle}</h2><p>{contact.courseHelpBody}</p></div>
    <WhatsAppContactAction>{contact.courseHelpAction}</WhatsAppContactAction>
  </aside>;
}
