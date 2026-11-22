import { z } from 'zod';
import type { SiteLanguage } from '@/locales/language';
import { serverSupabase } from '@/server/supabase';
import styles from '../teaching/calendar-connection.module.css';

const copy = {
  en: {
    title: 'Request slides in Google Drive',
    disabled: 'Drive sync is turned off in this environment.',
    awaiting_consent: 'Waiting for the owner to connect Google Drive.',
    reconnect: 'The owner needs to authorize Google Drive again.',
    connected: 'Google Drive is connected for new requests.',
    unavailable: 'Drive connection status is temporarily unavailable.',
    consent_failed: 'Google Drive authorization did not finish. Sign in with the owner account and try again.',
    consent: 'Authorizing gittutor2@gmail.com enables private Drive copies of slides uploaded to new tutoring requests after connection. Existing requests are excluded.',
    action: 'Authorize Drive and sync new slides', renew: 'Renew Drive authorization',
  },
  ar: {
    title: 'شرائح الطلبات في Google Drive',
    disabled: 'مزامنة Google Drive متوقفة في هذه البيئة.',
    awaiting_consent: 'بانتظار ربط حساب المالك بخدمة Google Drive.',
    reconnect: 'يحتاج المالك إلى إعادة تفويض Google Drive.',
    connected: 'تم ربط Google Drive للطلبات الجديدة.',
    unavailable: 'يتعذر عرض حالة ربط Google Drive مؤقتًا.',
    consent_failed: 'لم يكتمل تفويض Google Drive. سجّل الدخول بحساب المالك وحاول مجددًا.',
    consent: 'بتفويض الحساب gittutor2@gmail.com، ستُحفظ نسخ خاصة في Google Drive من الشرائح المرفوعة لطلبات الدروس الجديدة بعد الربط. لا تشمل المزامنة الطلبات السابقة.',
    action: 'تفويض Google Drive ومزامنة الشرائح الجديدة', renew: 'تجديد تفويض Google Drive',
  },
};

const statusSchema = z.object({
  state: z.enum(['connected', 'awaiting_consent', 'reconnect']), can_connect: z.boolean(),
});
async function connectionStatus(enabled: boolean) {
  if (!enabled) return { state: 'disabled' as const, can_connect: false };
  try {
    const client = await serverSupabase();
    const { data, error } = await client.rpc('get_request_drive_status');
    if (!error) return statusSchema.parse(data);
  } catch { /* Keep the rest of Admin Integrations available during a database outage. */ }
  return { state: 'unavailable' as const, can_connect: false };
}

export async function RequestDriveConnection({ enabled, language, outcome }: { enabled: boolean; language: SiteLanguage; outcome?: string }) {
  const text = copy[language];
  const status = await connectionStatus(enabled);
  return <section className={styles.panel} aria-labelledby="request-drive-heading">
    <h2 id="request-drive-heading">{text.title}</h2>
    <p role="status">{text[status.state]}</p>
    {outcome === 'consent_failed' && <p role="alert">{text.consent_failed}</p>}
    {outcome === 'unavailable' && status.state !== 'unavailable' && <p role="alert">{text.unavailable}</p>}
    {status.can_connect && <form action="/api/drive/connect" method="post">
      <p>{text.consent}</p>
      <button className={styles.secondary} type="submit">{status.state === 'connected' ? text.renew : text.action}</button>
    </form>}
  </section>;
}
