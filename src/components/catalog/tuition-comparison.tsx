import { arabicSessionLength } from '@/locales/ar-public';
import type { SiteLanguage } from '@/locales/language';
import Link from 'next/link';
import { sessionLength, tuition } from '../../modules/catalog/public-tuition';
import styles from './tuition.module.css';

/** Separate customer-only contract: never import compensation authoring data here. */
export function TuitionComparison({ language = 'en' }: { language?: SiteLanguage } = {}) {
  const ar = language === 'ar';
  const number = (value: number) => value.toLocaleString(ar ? 'ar-EG' : 'en-EG');
  return <section className={styles.comparison} aria-label={ar ? 'أسعار الحصص' : 'Session pricing'}>
    <div className={styles.context}>
      <h1>{ar ? 'أسعار الحصص الفردية والجماعية' : 'Clear prices. Your course, your pace.'}</h1>
      <p>{ar ? <>راجع شرائحك وملاحظاتك وأسئلتك في حصة مدتها {arabicSessionLength}. الأسعار <strong>للطالب في الحصة الواحدة</strong>.</> : <>Work through your slides, course notes and questions in {sessionLength}. Every price is <strong>per student, per session</strong>.</>}</p>
      <Link className={styles.action} href="/learn/requests">{ar ? 'اطلب حصة' : 'Request a session'} <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></Link>
    </div>
    <div>
      <table className={styles.table} aria-label={ar ? 'رسوم الحصص الفردية والجماعية' : 'Individual and group tuition'}>
        <thead><tr><th scope="col">{ar ? 'نظام الدراسة' : 'Study format'}</th><th scope="col">{ar ? 'السعر للطالب' : 'Price per student'}</th></tr></thead>
        <tbody>{tuition.tiers.map(tier => (
          <tr key={tier.format}>
            <th scope="row">
              <strong>{ar ? ['','حصة فردية','مجموعة من طالبين','مجموعة من ثلاثة طلاب','مجموعة من أربعة طلاب'][tier.students] : tier.students === 1 ? 'Individual' : `Group of ${tier.students}`}</strong>
              <p>{ar ? (tier.students === 1 ? 'شرح مخصّص لطالب واحد.' : 'شرح لمجموعة تدرس الموضوع نفسه.') : tier.students === 1 ? 'One student, focused support.' : `${tier.students} students learning together.`}</p>
            </th>
            <td className={styles.price}>{ar ? 'ج.م.' : 'EGP'} <strong>{number(tier.price_minor / 100)}</strong></td>
          </tr>
        ))}</tbody>
      </table>
      <p className={styles.note}>{ar ? 'أرسل المواد والمواعيد التي تناسبك. سنراجع الطلب ونرشّح مدرّسًا ثم نؤكد الموعد والشروط معك.' : 'Send your material and preferred times. We’ll review your request, find the right tutor and confirm the schedule and terms with you.'}</p>
    </div>
  </section>;
}
