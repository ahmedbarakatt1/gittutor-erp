import type { ChartGroup, WorkbookChart } from './record-insights';
import styles from './operational-workspaces.module.css';

export type ChartSelection = { chart: string; group: string };
type Props = {
  charts: WorkbookChart[];
  selected: ChartSelection | null;
  onSelect: (selection: ChartSelection) => void;
  recordsId: string;
};

export function WorkbookCharts({ charts, selected, onSelect, recordsId }: Props) {
  if (!charts.length) return null;
  return <div className={styles.charts} data-workbook-charts>
    {charts.map(chart => {
      const isActivity = chart.key === 'activity';
      const unit = chart.key === 'progress' ? 'package' : chart.key === 'balances' ? 'record' : 'session';
      const months = isActivity ? chart.groups.filter(group => group.shortLabel) : [];
      const highest = Math.max(1, ...months.map(group => group.ids.length));
      const controls = (group: ChartGroup) => ({
        type: 'button' as const,
        'aria-pressed': selected?.chart === chart.key && selected.group === group.key,
        'aria-controls': recordsId,
        'aria-label': 'Show ' + group.ids.length + (group.ids.length === 1 ? ' record for ' : ' records for ') + group.label,
        disabled: group.ids.length === 0,
        onClick: () => onSelect({ chart: chart.key, group: group.key }),
      });
      return <figure key={chart.key} className={styles.chart}>
        <figcaption><div className={styles.chartTitle}><h3>{chart.title}</h3><span>{chart.total} {unit}{chart.total === 1 ? '' : 's'}</span></div><p>{chart.caption}</p></figcaption>
        {isActivity ? <>
          {months.length > 0 && <div className={styles.months}>{months.map(group =>
            <button key={group.key} {...controls(group)} title={group.label + ' · ' + group.ids.length}>
              <span className={styles.monthPlot} aria-hidden="true"><span className={styles.monthBar} style={{ height: (100 * group.ids.length / highest) + '%' }} /></span>
              <strong>{group.ids.length}</strong><span>{group.shortLabel}</span>
            </button>)}</div>}
          {chart.groups.some(group => !group.shortLabel) && <div className={styles.monthNotes}>
            {chart.groups.filter(group => !group.shortLabel).map(group => <button key={group.key} {...controls(group)}>{group.label} <b>{group.ids.length}</b></button>)}
          </div>}
        </> : <div className={styles.bars}>{chart.groups.map(group => <button key={group.key} {...controls(group)} title={group.ids.length + ' of ' + chart.total + ' records'}>
          <span>{group.label}</span>
          <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} data-group={group.key} style={{ width: (100 * group.ids.length / chart.total) + '%' }} /></span>
          <strong>{group.ids.length}</strong>
        </button>)}</div>}
      </figure>;
    })}
  </div>;
}
