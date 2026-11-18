import { cohortConversionRate } from '@/modules/analytics/acquisition';
import type { CohortReport, WorkloadReport } from '@/modules/analytics/queries';
import styles from './workspace.module.css';

type Bar = { label: string; value: number; display: string };

function BarChart({ title, note, rows, maximum }: { title: string; note: string; rows: Bar[]; maximum: number }) {
  return <figure className={styles.chart}>
    <figcaption><strong>{title}</strong><span>{note}</span></figcaption>
    <ul>{rows.map(({ label, value, display }) => <li key={label}>
      <span>{label}</span>
      <span className={styles.track} aria-hidden="true"><span style={{ width: `${maximum > 0 ? value / maximum * 100 : 0}%` }} /></span>
      <strong>{display}</strong>
    </li>)}</ul>
  </figure>;
}

function share(label: string, value: number, total: number): Bar {
  return { label, value, display: `${value} of ${total}` };
}

export function duration(seconds: number) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600), minutes = Math.floor(rounded % 3600 / 60), remainder = rounded % 60;
  return [hours && `${hours}h`, minutes && `${minutes}m`, remainder && `${remainder}s`].filter(Boolean).join(' ') || '0s';
}

export function CohortCharts({ report }: { report: CohortReport }) {
  const s = report.summary, rate = cohortConversionRate([s]);
  return <>
    <dl className={styles.headlines}>
      <div><dt>Cohort learners</dt><dd>{s.learners}</dd><dd>{s.interactions} inquiry interactions</dd></div>
      <div><dt>New learner conversion</dt><dd>{rate === null ? 'Not calculable' : `${(rate * 100).toFixed(1)}%`}</dd><dd>{s.newly_taught} of {s.learners} newly taught</dd></div>
      <div><dt>Provisional learners</dt><dd>{s.provisional}</dd><dd>Observation window still open</dd></div>
    </dl>
    {s.learners > 0 && <div className={styles.charts}>
      <BarChart title="Learner milestones" note="Payment and attendance are separate milestones." maximum={s.learners}
        rows={[share('Accepted booking', s.booked, s.learners), share('Settled payment', s.paid, s.learners),
          share('Approved attendance', s.attended, s.learners), share('Newly taught', s.newly_taught, s.learners)]} />
      <BarChart title="First inquiry source" note="Attribution for the same cohort of learners." maximum={s.learners}
        rows={[share('Verified campaign', s.verified_campaign, s.learners), share('Verified organic', s.verified_organic, s.learners),
          share('Unknown source', s.unknown_source, s.learners)]} />
    </div>}
    <p className={styles.note}><strong>History coverage</strong> · {s.returning} returning learners · {s.unknown_history} with unknown lifetime history. Newly taught learners have verified history and first approved attendance within the window.</p>
  </>;
}

export function WorkloadCharts({ report }: { report: WorkloadReport }) {
  const s = report.summary;
  return <>
    <dl className={styles.headlines}>
      <div><dt>Open conversations</dt><dd>{s.open_conversations}</dd><dd>{s.unassigned_conversations} unassigned now</dd></div>
      <div><dt>Average first reply</dt><dd>{s.answered_conversations ? duration(s.total_response_seconds / s.answered_conversations) : 'Not calculable'}</dd><dd>{s.answered_conversations} answered conversations</dd></div>
      <div><dt>Time under ownership</dt><dd>{duration(s.total_owned_seconds)}</dd><dd>Across conversations in the period</dd></div>
    </dl>
    <div className={styles.charts}>
      <BarChart title="Teaching time" note="Scheduled and delivered time each count a session once." maximum={Math.max(s.scheduled_seconds, s.delivered_seconds)}
        rows={[{ label: 'Scheduled', value: s.scheduled_seconds, display: duration(s.scheduled_seconds) },
          { label: 'Delivered', value: s.delivered_seconds, display: duration(s.delivered_seconds) }]} />
      <BarChart title="Current support queue" note={s.open_conversations ? 'Open conversations grouped by current ownership.' : 'No conversations are currently open.'} maximum={s.open_conversations}
        rows={[share('Assigned', s.open_conversations - s.unassigned_conversations, s.open_conversations),
          share('Unassigned', s.unassigned_conversations, s.open_conversations)]} />
    </div>
    <p className={styles.note}>Staffed-hours coverage is unknown. First replies use elapsed wall time, totaling {duration(s.total_response_seconds)} across answered conversations.</p>
  </>;
}
