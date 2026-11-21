import { staffText } from '@/locales/ar-staff';
import type { SiteLanguage } from '@/locales/language';
import type { WorkflowOperationsRecord as Row, WorkflowOperationsSection } from '@/modules/workflow-import/operational-model';

export type ChartGroup = { key: string; label: string; ids: string[]; shortLabel?: string };
export type WorkbookChart = {
  key: string;
  title: string;
  caption: string;
  groups: ChartGroup[];
  total: number;
};

function groupRecords(rows: Row[], labels: Record<string, string>, classify: (row: Row) => string): ChartGroup[] {
  const groups = Object.entries(labels).map(([key, label]) => ({ key, label, ids: [] as string[] }));
  const byKey = new Map(groups.map(group => [group.key, group]));
  for (const row of rows) byKey.get(classify(row))?.ids.push(row.id);
  return groups;
}

function outcomes(rows: Row[]): WorkbookChart {
  const groups = groupRecords(rows, { completed: 'Completed', scheduled: 'Scheduled', canceled: 'Canceled', other: 'Other status', missing: 'No status' }, row => {
    const status = row.reported_status?.trim().toLowerCase();
    if (!status) return 'missing';
    if (status === 'cancelled') return 'canceled';
    return ['completed', 'scheduled', 'canceled'].includes(status) ? status : 'other';
  }).filter(group => group.ids.length || !['other', 'missing'].includes(group.key));
  return { key: 'outcomes', title: 'Session outcomes', caption: 'Share of session records by reported status.', total: rows.length, groups };
}

export function workbookDateTime(date: string | null) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const instant = Date.parse(date);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== date) return null;
  return instant;
}

function activity(rows: Row[], language: SiteLanguage): WorkbookChart {
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB';
  const fullMonth = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const shortMonth = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const months = rows.map(row => row.date && workbookDateTime(row.date) !== null ? row.date.slice(0, 7) : null);
  const dated = months.filter((value): value is string => value !== null).sort();
  const groups: ChartGroup[] = [];
  const first = dated[0], last = dated.at(-1);
  if (first && last) {
    const cursor = new Date(last + '-01T00:00:00Z');
    // Work back from the workbook's newest date, including months with zero source rows.
    for (let step = 0; step < 6; step++) {
      const key = cursor.toISOString().slice(0, 7);
      if (key < first) break;
      groups.unshift({ key, label: fullMonth.format(cursor), shortLabel: shortMonth.format(cursor), ids: [] });
      if (key === first) break;
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
  }
  const byMonth = new Map(groups.map(group => [group.key, group]));
  const earlier: ChartGroup = { key: 'earlier', label: 'Earlier months', ids: [] };
  const missing: ChartGroup = { key: 'missing', label: 'No valid date', ids: [] };
  rows.forEach((row, index) => (byMonth.get(months[index] ?? '') ?? (months[index] ? earlier : missing)).ids.push(row.id));
  const period = groups.length < 2 ? groups[0]?.label : groups[0].label + ' – ' + groups[groups.length - 1].label;
  if (earlier.ids.length) groups.push(earlier);
  if (missing.ids.length) groups.push(missing);
  return { key: 'activity', title: 'Session activity', caption: period ? staffText(language, 'Session rows by workbook date · ') + period : 'Session rows have no valid workbook dates.', total: rows.length, groups };
}

function sourceNumber(row: Row, key: string, type: 'number' | 'money') {
  const value = row.fields.find(field => field.key === key && field.type === type)?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function packageProgress(rows: Row[]): WorkbookChart {
  const groups = groupRecords(rows, { complete: 'All completed', partial: 'Partly completed', none: 'None completed', unknown: 'Unknown' }, row => {
    const total = sourceNumber(row, 'total_sessions', 'number');
    const completed = sourceNumber(row, 'sessions_completed', 'number');
    if (total === null || total <= 0 || completed === null || completed < 0 || completed > total) return 'unknown';
    if (completed === total) return 'complete';
    return completed === 0 ? 'none' : 'partial';
  });
  return { key: 'progress', title: 'Package progress', caption: 'Packages grouped by reported completed and total sessions. Unknown includes missing or inconsistent counts.', total: rows.length, groups };
}

function buildCharts(view: WorkflowOperationsSection['key'], records: Row[], language: SiteLanguage): WorkbookChart[] {
  if (view === 'overview' || view === 'sessions') {
    const sessions = records.filter(row => row.source_table === 'sessions');
    if (sessions.length) return [outcomes(sessions), activity(sessions, language)];
  }
  if (view === 'packages' || view === 'overview') {
    const packages = records.filter(row => row.source_table === 'packages');
    if (packages.length) return [packageProgress(packages)];
  }
  if (view === 'payments' || view === 'tutor_pay') {
    const key = view === 'payments' ? 'student_balance_minor' : 'tutor_fee_balance_minor';
    if (!records.some(row => row.fields.some(field => field.key === key && field.type === 'money'))) return [];
    const groups = groupRecords(records, { positive: 'Above zero', zero: 'Zero balance', negative: 'Below zero', missing: 'No reported value' }, row => {
      const value = sourceNumber(row, key, 'money');
      if (value === null) return 'missing';
      if (value === 0) return 'zero';
      return value > 0 ? 'positive' : 'negative';
    });
    const caption = view === 'payments' ? 'Session and package records grouped by reported student balance in EGP.' : 'Session records grouped by reported tutor fee balance in EGP.';
    return [{ key: 'balances', title: 'Reported balance distribution', caption, total: records.length, groups }];
  }
  return [];
}

export function workbookCharts(view: WorkflowOperationsSection['key'], records: Row[], language: SiteLanguage = 'en'): WorkbookChart[] {
  const charts = buildCharts(view, records, language);
  if (language === 'en') return charts;
  return charts.map(chart => ({
    ...chart, title: staffText(language, chart.title), caption: staffText(language, chart.caption),
    groups: chart.groups.map(group => ({ ...group, label: staffText(language, group.label) })),
  }));
}
