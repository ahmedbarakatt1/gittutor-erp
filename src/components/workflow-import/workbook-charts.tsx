import { useSiteLanguage } from '../site-language';
import { useStaffText } from '@/components/ar-staff-label';
import { useState } from 'react';
import type { ChartGroup, WorkbookChart } from './record-insights';
import styles from './operational-workspaces.module.css';

export type ChartSelection = { chart: string; group: string };
type Props = {
  charts: WorkbookChart[];
  selected: ChartSelection | null;
  onSelect: (selection: ChartSelection) => void;
  recordsId: string;
  compactOverview?: boolean;
};

export function WorkbookCharts({ charts, selected, onSelect, recordsId, compactOverview }: Props) {
  const t = useStaffText();
  const arabic = useSiteLanguage() === 'ar';
  const count = (n: number) => n.toLocaleString(arabic ? 'ar-EG' : 'en-GB');

  const [chartKey, setChartKey] = useState('');
  if (!charts.length) return null;
  const switchable = compactOverview && charts.length > 1;
  const current = charts.find(chart => chart.key === chartKey) ?? charts[0];
  return <div className={styles.charts} data-workbook-charts>
    {switchable && <div className={styles.chartPicker} role="group" aria-label={t("Chart to display")}>
      {charts.map(chart => <button key={chart.key} type="button" aria-pressed={current.key === chart.key}
        aria-controls={recordsId + '-' + chart.key} onClick={() => setChartKey(chart.key)}>{chart.title}</button>)}
    </div>}
    {charts.map(chart => {
      const isActivity = chart.key === 'activity';
      const unit = chart.key === 'progress' ? 'package' : chart.key === 'balances' ? 'record' : 'session';
      const months = isActivity ? chart.groups.filter(group => group.shortLabel) : [];
      const highest = Math.max(1, ...months.map(group => group.ids.length));
      const controls = (group: ChartGroup) => ({
        type: 'button' as const,
        'aria-pressed': selected?.chart === chart.key && selected.group === group.key,
        'aria-controls': recordsId,
        'aria-label': arabic ? 'عرض السجلات لفئة ' + group.label + ' (' + count(group.ids.length) + ')' : 'Show ' + group.ids.length + (group.ids.length === 1 ? ' record for ' : ' records for ') + group.label,
        disabled: group.ids.length === 0,
        onClick: () => onSelect({ chart: chart.key, group: group.key }),
      });
      return <figure key={chart.key} id={recordsId + '-' + chart.key} className={styles.chart} data-inactive={switchable && current.key !== chart.key || undefined}>
        <figcaption><div className={styles.chartTitle}><h3>{chart.title}</h3><span>{arabic ? (unit === 'session' ? 'عدد الحصص: ' : unit === 'package' ? 'عدد الباقات: ' : 'عدد السجلات: ') + count(chart.total) : chart.total + ' ' + unit + (chart.total === 1 ? '' : 's')}</span></div><p>{chart.caption}</p></figcaption>
        {isActivity ? <>
          {months.length > 0 && <div className={styles.months}>{months.map(group =>
            <button key={group.key} {...controls(group)} title={group.label + ' · ' + count(group.ids.length)}>
              <span className={styles.monthPlot} aria-hidden="true"><span className={styles.monthBar} style={{ height: (100 * group.ids.length / highest) + '%' }} /></span>
              <strong>{count(group.ids.length)}</strong><span>{group.shortLabel}</span>
            </button>)}</div>}
          {chart.groups.some(group => !group.shortLabel) && <div className={styles.monthNotes}>
            {chart.groups.filter(group => !group.shortLabel).map(group => <button key={group.key} {...controls(group)}>{group.label} <b>{count(group.ids.length)}</b></button>)}
          </div>}
        </> : <div className={styles.bars}>{chart.groups.map(group => <button key={group.key} {...controls(group)} title={count(group.ids.length) + t(' of ') + count(chart.total) + t(' records')}>
          <span>{group.label}</span>
          <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} data-group={group.key} style={{ width: (100 * group.ids.length / chart.total) + '%' }} /></span>
          <strong>{count(group.ids.length)}</strong>
        </button>)}</div>}
      </figure>;
    })}
  </div>;
}
