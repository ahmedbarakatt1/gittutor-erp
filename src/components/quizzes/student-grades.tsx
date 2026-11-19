'use client';

import type { CustomerQuizResult } from '@/modules/teaching/quizzes';
import { quizCopy as copy } from '@/locales/quizzes';
import { cairoDate } from '../booking/shared';
import { PaymentReadState, usePaymentList } from '../payments/shared';
import styles from './quizzes.module.css';

export function StudentGrades() {
  const results = usePaymentList<CustomerQuizResult>('me/quiz-results');
  return <section className={styles.workspace} aria-label={copy.results}>
    {results.items?.length === 0 && <p className={styles.empty}>{copy.empty}</p>}
    {!!results.items?.length && <ul className={styles.results}>
      {results.items.map(row => <li key={row.learner_id + row.quiz_id} className={styles.result}>
        <div>
          <p className={styles.meta}>{row.learner_name} · {cairoDate(row.start_at)}</p>
          <h2>{row.title}</h2>
          <p>{row.session_title}</p>
        </div>
        <div className={styles.score}>
          {row.grade === null ? <span>{copy.awaiting}</span> : <>
            <strong>{row.grade.score} / {row.max_score}</strong>
            <progress aria-label={`${row.title}, ${row.grade.score} ${copy.outOf} ${row.max_score}`} value={row.grade.score} max={row.max_score} />
          </>}
        </div>
        {row.content_path === `/api/v1/files/${row.file_id}/content`
          ? <a href={row.content_path} aria-label={`${copy.pdf} · ${row.title}`} download>{copy.pdf}</a>
          : <span className={styles.meta}>{copy.unavailable}</span>}
      </li>)}
    </ul>}
    <PaymentReadState pending={!results.items} {...results} />
  </section>;
}
