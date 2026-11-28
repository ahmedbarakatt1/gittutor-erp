import { pageMetadata } from '@/server/page-metadata';
import { AuthPage } from '@/components/auth-page';

export const generateMetadata = pageMetadata({ title: 'Create an account | Git Tutor', robots: { index: false, follow: false } });

export default function SignupPage() { return <AuthPage mode="signup" />; }
