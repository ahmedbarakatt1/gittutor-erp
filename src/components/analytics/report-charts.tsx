import { useStaffText } from '@/components/ar-staff-label';
import { useSiteLanguage } from '@/components/site-language';
import type { SiteLanguage } from '@/locales/language';
import { cohortConversionRate } from '@/modules/analytics/acquisition';
import type { CohortReport, WorkloadReport } from '@/modules/analytics/queries';
import styles from './workspace.module.css';

type Bar = { label: string; value: number; display?: string; total?: number };

function BarChart({ title, note, rows, maximum }: { title: string; note: string; rows: Bar[]; maximum: number }) {
  const t = useStaffText();
  return <figure className={styles.chart}>
    <figcaption><strong>{title}</strong><span>{note}</span></figcaption>
    <ul>{rows.map(({ label, value, display, total }) => <li key={label}>
      <span>{t(label)}</span>
      <span className={styles.track} aria-hidden="true"><span style={{ width: `${maximum > 0 ? value / maximum * 100 : 0}%` }} /></span>
      <strong>{total === undefined ? display : <>{value} {t('of')} {total}</>}</strong>
    </li>)}</ul>
  </figure>;
}

function share(label: string, value: number, total: number): Bar {
  return { label, value, total };
}

export function duration(seconds: number, language: SiteLanguage = 'en') {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600), minutes = Math.floor(rounded % 3600 / 60), remainder = rounded % 60;
  if (language === 'ar') return [hours && `${hours} س`, minutes && `${minutes} د`, remainder && `${remainder} ث`].filter(Boolean).join(' ') || '0 ث';
  return [hours && `${hours}h`, minutes && `${minutes}m`, remainder && `${remainder}s`].filter(Boolean).join(' ') || '0s';
}

export function CohortCharts({ report }: { report: CohortReport }) {
  const t = useStaffText();

  const s = report.summary, rate = cohortConversionRate([s]);
  return <>
    <dl className={styles.headlines}>
      <div><dt>{t("Cohort learners")}</dt><dd>{s.learners}</dd><dd>{s.interactions}{t(" inquiry interactions")}</dd></div>
      <div><dt>{t("New learner conversion")}</dt><dd>{rate === null ? t("Not calculable") : `${(rate * 100).toFixed(1)}%`}</dd><dd>{s.newly_taught} {t('of')} {s.learners}{t(" newly taught")}</dd></div>
      <div><dt>{t("Provisional learners")}</dt><dd>{s.provisional}</dd><dd>{t("Observation window still open")}</dd></div>
    </dl>
    {s.learners > 0 && <div className={styles.charts}>
      <BarChart title={t("Learner milestones")} note={t("Payment and attendance are separate milestones.")} maximum={s.learners}
        rows={[share('Accepted booking', s.booked, s.learners), share('Settled payment', s.paid, s.learners),
          share('Approved attendance', s.attended, s.learners), share('Newly taught', s.newly_taught, s.learners)]} />
      <BarChart title={t("First inquiry source")} note={t("Attribution for the same cohort of learners.")} maximum={s.learners}
        rows={[share('Verified campaign', s.verified_campaign, s.learners), share('Verified organic', s.verified_organic, s.learners),
          share('Unknown source', s.unknown_source, s.learners)]} />
    </div>}
    <p className={styles.note}><strong>{t("History coverage")}</strong> · {s.returning}{t(" returning learners · ")}{s.unknown_history}{t(" with unknown lifetime history. Newly taught learners have verified history and first approved attendance within the window.")}</p>
  </>;
}

export function WorkloadCharts({ report }: { report: WorkloadReport }) {
  const t = useStaffText();

  const language = useSiteLanguage();
  const elapsed = (seconds: number) => duration(seconds, language);
  const s = report.summary;
  return <>
    <dl className={styles.headlines}>
      <div><dt>{t("Open conversations")}</dt><dd>{s.open_conversations}</dd><dd>{s.unassigned_conversations}{t(" unassigned now")}</dd></div>
      <div><dt>{t("Average first reply")}</dt><dd>{s.answered_conversations ? elapsed(s.total_response_seconds / s.answered_conversations) : t("Not calculable")}</dd><dd>{s.answered_conversations}{t(" answered conversations")}</dd></div>
      <div><dt>{t("Time under ownership")}</dt><dd>{elapsed(s.total_owned_seconds)}</dd><dd>{t("Across conversations in the period")}</dd></div>
    </dl>
    <div className={styles.charts}>
      <BarChart title={t("Teaching time")} note={t("Scheduled and delivered time each count a session once.")} maximum={Math.max(s.scheduled_seconds, s.delivered_seconds)}
        rows={[{ label: 'Scheduled', value: s.scheduled_seconds, display: elapsed(s.scheduled_seconds) },
          { label: 'Delivered', value: s.delivered_seconds, display: elapsed(s.delivered_seconds) }]} />
      <BarChart title={t("Current support queue")} note={s.open_conversations ? t("Open conversations grouped by current ownership.") : t("No conversations are currently open.")} maximum={s.open_conversations}
        rows={[share('Assigned', s.open_conversations - s.unassigned_conversations, s.open_conversations),
          share('Unassigned', s.unassigned_conversations, s.open_conversations)]} />
    </div>
    <p className={styles.note}>{t("Staffed-hours coverage is unknown. First replies use elapsed wall time, totaling ")}{elapsed(s.total_response_seconds)}{t(" across answered conversations.")}</p>
  </>;
}
