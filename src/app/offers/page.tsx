import type { Metadata } from 'next';
import { PublicShell } from '@/components/catalog/public-shell';
import { TuitionComparison } from '@/components/catalog/tuition-comparison';
import styles from '@/components/catalog/catalog.module.css';

export const metadata: Metadata = { title: 'Session pricing | Git Tutor', description: 'Individual sessions at EGP 650 and groups of 2–4 from EGP 500 per student. Sessions last 90–105 minutes.' };
export default function PricingPage() {
  return <PublicShell active="offers"><div className={styles.intro}><h1>Clear prices.<br />Your course, your pace.</h1><p>Bring the material you need help with. Our pricing follows the study format you choose.</p></div><TuitionComparison /></PublicShell>;
}
