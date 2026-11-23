import { getSiteLanguage } from '@/server/site-language';
import styles from '@/components/auth.module.css';

export default async function SessionEnded() {
  const arabic = await getSiteLanguage() === 'ar';
  return <main className={styles.verification}>
    <h1>{arabic ? 'انتهت الجلسة في علامة التبويب هذه' : 'This tab’s session has ended'}</h1>
    <p>{arabic ? 'أعد فتح حسابك للمتابعة. إذا كنت تشارك الجهاز، استخدم ملف متصفح منفصل لكل شخص.' : 'Open your account again to continue. On a shared device, use a separate browser profile for each person.'}</p>
    <a className={styles.primary} href="/login">{arabic ? 'الانتقال إلى تسجيل الدخول' : 'Go to sign in'}</a>
  </main>;
}
