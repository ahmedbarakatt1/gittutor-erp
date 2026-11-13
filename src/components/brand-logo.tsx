import Image from 'next/image';
import styles from './brand-logo.module.css';

/** Original asset from the user-authorized @gittutor Instagram profile. */
export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <Image src="/brand/git-tutor-instagram.jpg" alt="Git Tutor" width={150} height={150} unoptimized loading="eager" className={`${styles.logo} ${compact ? styles.compact : ''}`} />;
}
