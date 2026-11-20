import { sessionLength } from '@/modules/catalog/public-tuition';

import type { Metadata } from 'next';
import { PublicShell } from '@/components/catalog/public-shell';
import { TuitionComparison } from '@/components/catalog/tuition-comparison';

export const metadata: Metadata = { title: 'Session pricing | Git Tutor', description: `View individual and group tuition per student. Sessions last ${sessionLength}.` };
export default function PricingPage() {
  return <PublicShell active="offers"><TuitionComparison /></PublicShell>;
}
