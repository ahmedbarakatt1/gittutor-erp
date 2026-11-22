'use client';

import type { ScanRetry } from '@/modules/files/queries';
import { useSiteLanguage } from '../site-language';
import { IdentityForm } from '../identity-form';
import { PaymentReadState, usePaymentList } from '../payments/shared';
import styles from '../auth.module.css';

const messages = {
  en: { title: 'Files waiting for a new scan', empty: 'No files are waiting for a scan retry.', retry: 'Retry scan', queued: 'A new scan has been queued.', stale: 'Scanner signatures need updating.', unavailable: 'The scanner could not complete the check.' },
  ar: { title: 'ملفات تنتظر إعادة الفحص', empty: 'لا توجد ملفات تنتظر إعادة الفحص.', retry: 'إعادة الفحص', queued: 'أُضيف الملف إلى قائمة الفحص.', stale: 'تحتاج قاعدة بيانات الفحص إلى تحديث.', unavailable: 'تعذّر على الماسح إكمال الفحص.' },
};

export function ScanRecoveryPanel() {
  const copy = messages[useSiteLanguage()];
  const records = usePaymentList<ScanRetry>('file-scan-retries');
  return <section className={styles.section}>
    <h2>{copy.title}</h2>
    <PaymentReadState pending={!records.items && !records.error} {...records} />
    {records.items?.length === 0 && <p>{copy.empty}</p>}
    <ul>{records.items?.map(file => <li key={file.file_id}>
      <strong>{file.filename}</strong>
      <p>{file.reason === 'SCANNER_SIGNATURES_STALE' ? copy.stale : copy.unavailable}</p>
      <IdentityForm action={`files/${file.file_id}/retry-scan`} submitLabel={copy.retry} successMessage={copy.queued}
        payload={() => ({ expected_version: file.version })} onSaved={records.reload} resettable={false}>{null}</IdentityForm>
    </li>)}</ul>
  </section>;
}
