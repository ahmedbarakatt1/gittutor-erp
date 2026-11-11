import { publicContact as contact } from '@/locales/contact';
import styles from './public-contact.module.css';

export function PublicContactLinks() {
  return <address className={styles.links} aria-label={contact.label}><a href={contact.whatsappHref}>{contact.whatsapp}</a><a href={contact.phoneHref}><span className={styles.call}>{contact.call}</span> <bdi dir="ltr">{contact.phoneDisplay}</bdi></a><a href={contact.instagramHref}>{contact.instagram}</a></address>;
}

export function CourseHelp() {
  return <aside className={styles.help} aria-labelledby="course-help-title"><div><h2 id="course-help-title">{contact.courseHelpTitle}</h2><p>{contact.courseHelpBody}</p></div><a className={styles.action} href={contact.whatsappHref}>{contact.courseHelpAction}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a></aside>;
}
