import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import type { WorkflowOperationsData, WorkflowOperationsRecord } from '../../src/modules/workflow-import/operational-model';

const state = vi.hoisted(() => ({ data: undefined as unknown, reads: [] as (string | null)[] }));
vi.mock('server-only', () => ({}));
// Supply the completed HTTP read; all schema validation and rendering remain real.
vi.mock('../../src/components/payments/shared', () => ({
  usePaymentRecord: (path: string | null) => { state.reads.push(path); return { data: path ? state.data : undefined, reload: () => {} }; },
}));
vi.mock('../../src/server/auth', () => ({ requireAccount: async () => ({ roles: ['admin'] }) }));
vi.mock('../../src/server/supabase', () => ({ serverSupabase: async () => ({}) }));
vi.mock('../../src/modules/requests/queries', () => ({
  listRequestQueue: async (_client: unknown, options: { limit: number }) => {
    expect(options.limit).toBe(1);
    return { items: [{ topic: 'Synthetic calculus request', description: 'Private preparation notes' }] };
  },
}));
vi.mock('../../src/modules/workflow-import/operational-queries', () => ({ getWorkflowOperations: async () => state.data }));
import AdminPage from '../../src/app/admin/page';
import ServicePage from '../../src/app/service/page';
import TutorPage from '../../src/app/tutor/page';
import { listTutorOccurrences } from '../../src/modules/booking/queries';
vi.mock('../../src/modules/booking/queries', () => ({ listTutorOccurrences: vi.fn() }));
import { WorkflowOperationsWorkspace } from '../../src/components/workflow-import/operational-workspaces';
import { workbookCharts } from '../../src/components/workflow-import/record-insights';

const uuid = (n: number) => `d3c78931-96e2-4d52-9860-${String(n).padStart(12, '0')}`;
function sourceRow(n: number, date: string | null, title: string): WorkflowOperationsRecord {
  return { id: uuid(n), title, subtitle: 'Synthetic course', source_table: 'sessions', source_row: n + 1, reported_status: 'Completed', date,
    fields: [{ key: 'course', label: 'Course', value: 'Synthetic course', type: 'text' }], issues: [], actions: [],
    review: { version: 1, state: 'linked', can_review: false }, links: { learner_id: null, tutor_id: null, occurrence_id: null, package_id: null } };
}
function data(view: 'sessions' | 'overview' | 'payments', records: WorkflowOperationsRecord[]): WorkflowOperationsData {
  return { enabled: true, role: 'owner', mapping_options: { learners: [], tutors: [] }, sections: [{ key: view, title: 'Workbook records', description: 'Historical reports', metrics: [], records }] };
}
const render = (view: 'sessions' | 'overview' | 'payments', collapsed = false) => renderToStaticMarkup(createElement(WorkflowOperationsWorkspace, { workspace: 'admin', view, collapsed }, createElement('button', null, 'Continue current workflow')));
beforeEach(() => { state.data = undefined; state.reads.length = 0; });

test('tutor overview shows the next two assigned lessons in Cairo time and keeps fee agreements out of the preview', async () => {
  const response = data('overview', [sourceRow(1, '2026-10-01', 'Synthetic lesson')]);
  if (!response.enabled) throw Error('Expected enabled fixture');
  response.role = 'tutor';
  state.data = response;
  vi.mocked(listTutorOccurrences).mockImplementation(async (_client, options) => {
    expect(options?.limit).toBe(2);
    expect(Date.parse(options!.from!)).toBeGreaterThan(Date.now() - 60000);
    const state = options?.state;
    if (state !== 'forming' && state !== 'confirmed') throw Error('Expected an upcoming teaching state');
    const days = state === 'forming' ? [2, 4] : [3, 5];
    return { items: days.map(day => ({
      occurrence: { occurrence_id: uuid(day), version: 1, offer_id: uuid(10), tutor: { tutor_id: uuid(11), display_name: 'Example tutor' },
        start_at: `2027-01-0${day}T10:00:00Z`, end_at: `2027-01-0${day}T11:30:00Z`, time_zone: 'Africa/Cairo',
        format: 'group', state, target_tier: 2, capacity: 2, available_seats: 0, waitlist_available: false,
        customer_price_minor: 57500, currency: 'EGP', pricing_version_id: uuid(12), policy_version_id: uuid(13) },
      fee_agreement: { fee_agreement_id: uuid(14), occurrence_id: uuid(day), occurrence_version: 1, tutor_id: uuid(11),
        target_tier: 2, fee_minor: 991234, currency: 'EGP', duration_minutes: 90, compensation_policy_version_id: uuid(15),
        purpose: 'initial', is_current: true, approved_at: '2026-11-20T10:00:00Z', accepted_at: null },
      roster: [], pending_proposals: [],
    })), next_cursor: null };
  });
  const page = await TutorPage();
  const preview = renderToStaticMarkup(page.props.primaryAction);
  expect(preview).toContain('12:00 Cairo');
  expect(preview.indexOf(uuid(2))).toBeGreaterThan(-1);
  expect(preview.indexOf(uuid(3))).toBeGreaterThan(preview.indexOf(uuid(2)));
  expect(preview).not.toContain(uuid(4));
  expect(preview).not.toContain('991234');
  const dashboard = renderToStaticMarkup(page.props.children[0]);
  expect(dashboard).toContain('/tutor/schedule');
  expect(dashboard).toContain('Chart to display');
  vi.mocked(listTutorOccurrences).mockResolvedValue({ items: [], next_cursor: null });
  expect(renderToStaticMarkup((await TutorPage()).props.children[0])).toContain('No upcoming sessions in the next 90 days');
  state.data = { enabled: false };
  vi.mocked(listTutorOccurrences).mockRejectedValue(new Error('Unavailable'));
  expect(renderToStaticMarkup((await TutorPage()).props.primaryAction)).toContain('Schedule preview unavailable');
});

test('service overview opens its staff queue and passes only the overview to the browser', async () => {
  const response = data('overview', [sourceRow(1, '2026-10-01', 'Synthetic lesson')]);
  if (!response.enabled) throw Error('Expected enabled fixture');
  response.role = 'service';
  response.sections.push({ key: 'payments', title: 'Payment register', description: '', metrics: [], records: [] });
  state.data = response;
  const workspace = (await ServicePage()).props.children;
  expect(workspace.props.initialData.role).toBe('service');
  expect(workspace.props.initialData.sections.map((section: { key: string }) => section.key)).toEqual(['overview']);
  const html = renderToStaticMarkup(workspace);
  expect(html).toContain('href="/service/requests"');
  expect(html).toContain('First in queue · Synthetic calculus request');
  expect(html).toContain('aria-label="Chart to display"');
  expect(html).not.toContain('/admin/requests');
  expect(html).not.toContain('Private preparation notes');
  state.data = { enabled: false };
  expect(renderToStaticMarkup((await ServicePage()).props.primaryAction)).toContain('href="/service/requests"');
});

test('admin overview renders its scoped figures on first paint and opens records on demand', async () => {
  const response = data('overview', [sourceRow(1, '2026-10-01', 'Synthetic lesson')]);
  if (!response.enabled) throw Error('Expected enabled fixture');
  response.mapping_options.tutors.push({ id: uuid(3), display_name: 'Unused mapping choice' });
  response.sections.push({ key: 'finance', title: 'Separate finance view', description: '', metrics: [], records: [sourceRow(2, null, 'Finance-only value')] });
  state.data = response;
  const page = await AdminPage();
  const [workspace] = page.props.children;
  expect(workspace.props.initialData.sections.map((section: { key: string }) => section.key)).toEqual(['overview']);
  expect(workspace.props.initialData.mapping_options).toEqual({ learners: [], tutors: [] });
  const html = renderToStaticMarkup(createElement('main', null, page.props.children));
  expect(state.reads).toEqual([null]);
  expect(html).toContain('Session outcomes');
  expect(html).toContain('Session activity');
  expect(html).toContain('aria-label="Chart to display"');
  expect(html).toMatch(/<figure[^>]*data-inactive="true"/);
  expect(html).toContain('Browse records');
  expect(html).toContain('Open request queue');
  expect(html).toContain('First in queue · Synthetic calculus request');
  expect(html).not.toContain('Private preparation notes');
  expect(html).toContain('Source records');
  expect(html).not.toContain('Search records');
  expect(html).not.toContain('Loading your records');
  expect(html).not.toContain('Finance-only value');
  expect(html.indexOf('Session activity')).toBeLessThan(html.indexOf('Daily operations'));

  response.sections[0].records[0].review.can_review = true;
  const [reviewWorkspace] = (await AdminPage()).props.children;
  expect(reviewWorkspace.props.initialData.mapping_options).toEqual(response.mapping_options);
});

test('disabled imports preserve the current workspace without preview notices', () => {
  state.data = { enabled: false };
  const html = render('sessions');
  expect(html).toContain('Continue current workflow');
  expect(html).not.toContain('data-workflow-operations');
  expect(html).not.toContain('fake providers');
});

test('overview shows four newest dated records and leaves undated history behind them', () => {
  state.data = data('overview', [sourceRow(1, null, 'Undated record'), sourceRow(2, '2026-10-01', 'Old record'), sourceRow(3, '2026-10-05', 'Newest record'), sourceRow(4, '2026-10-03', 'Third record'), sourceRow(5, '2026-10-04', 'Second record'), sourceRow(6, '2026-10-02', 'Fourth record')]);
  const html = render('overview');
  expect(html).toContain('Browse records');
  expect(html).toMatch(/<details\b[^>]*id="[^"]+-register"[^>]*>/);
  expect(html).not.toMatch(/<details\b[^>]*id="[^"]+-register"[^>]*\bopen(?:=|\s|>)/);
  expect(html.indexOf('Newest record')).toBeLessThan(html.indexOf('Second record'));
  expect(html.indexOf('Second record')).toBeLessThan(html.indexOf('Third record'));
  expect(html).toContain('Fourth record');
  expect(html).not.toContain('Old record');
  expect(html).not.toContain('Undated record');
  expect(html).toContain('Page 1 of 2');
});

test('payment cards show monetary fields before context and retain remaining details', () => {
  const row = sourceRow(1, null, 'Reported payment');
  row.fields = [
    ...Array.from({ length: 6 }, (_, index) => ({ key: `context_${index}`, label: `Context ${index}`, value: `Saved detail ${index}`, type: 'text' as const })),
    { key: 'student_balance_minor', label: 'Reported remaining balance', value: 1200, type: 'money' },
  ];
  state.data = data('payments', [row]);
  const html = render('payments');
  expect(html.indexOf('Reported remaining balance')).toBeLessThan(html.indexOf('Context 0'));
  const rowSummary = html.slice(html.indexOf('Reported payment')).split('</summary>')[0];
  expect(rowSummary).toContain('Reported remaining balance');
  expect(rowSummary).toContain('12.00');
  expect(html).toContain('Saved detail 5');
  expect(html).toContain('Completed · reported');
  expect(html).toContain('Imported history stays separate from activity recorded here.');
  expect(html).not.toContain('fake providers');
  expect(html).not.toContain('no real money moves');
});

test('a selected canonical workflow keeps workbook history closed and its controls available', () => {
  state.data = data('sessions', [sourceRow(1, null, 'Historical record')]);
  const html = render('sessions', true);
  expect(html).toMatch(/<details[^>]*><summary>Workbook history<\/summary>/);
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain('data-workflow-operations');
  expect(html).toContain('Continue current workflow');
});

test('customer rendering fails closed when the response contains private compensation', () => {
  const row = sourceRow(1, null, 'Restricted record');
  row.fields = [{ key: 'tutor_fee_due_minor', label: 'Private compensation must stay hidden', value: 9999, type: 'money' }];
  const response = data('sessions', [row]);
  if (response.enabled) response.role = 'customer';
  state.data = response;
  const html = render('sessions');
  expect(html).toContain('Workbook records could not be loaded.');
  expect(html).not.toContain('Private compensation must stay hidden');
  expect(html).not.toContain('Restricted record');
});

test('overview chart groups reconcile to the visible session rows without counting packages or dropping unknowns', () => {
  const records = [
    sourceRow(1, '2026-02-01', 'Earlier session'),
    sourceRow(2, '2026-10-05', 'October session'),
    sourceRow(3, '2026-10-07', 'Another October session'),
    sourceRow(4, '2026-02-31', 'Invalid business date'),
    sourceRow(5, null, 'Undated session'),
    { ...sourceRow(6, '2026-09-01', 'A package'), source_table: 'packages' as const },
  ];
  records[1].reported_status = null;
  records[2].reported_status = ' Cancelled ';
  records[3].reported_status = 'Other saved label';
  const [outcomes, months] = workbookCharts('overview', records);
  for (const chart of [outcomes, months]) {
    expect(chart.groups.flatMap(group => group.ids).sort()).toEqual(records.slice(0, 5).map(row => row.id).sort());
  }
  const counts = (chart: typeof outcomes) => Object.fromEntries(chart.groups.map(group => [group.key, group.ids.length]));
  expect(counts(outcomes)).toMatchObject({ completed: 2, canceled: 1, other: 1, missing: 1 });
  expect(counts(months)).toMatchObject({ earlier: 1, '2026-10': 2, '2026-09': 0, missing: 2 });
  state.data = data('overview', records);
  const html = render('overview');
  expect(html).toContain('Session outcomes');
  expect(html).toContain('Session activity');
  expect(html).toContain('aria-description="Show 2 records for Completed"');
  expect(html).not.toContain('NaN');
});

test('package progress requires both valid source counts and treats zero and missing explicitly', () => {
  const packages = [[4, 4], [4, 1], [4, 0], [0, 0], [null, null], [2, 3], [4, 1.5]].map(([total, completed], index) => ({
    ...sourceRow(index + 1, null, 'Test package'), source_table: 'packages' as const,
    fields: [{ key: 'total_sessions', label: 'Total', type: 'number' as const, value: total },
      { key: 'sessions_completed', label: 'Completed', type: 'number' as const, value: completed }],
  }));
  const [chart] = workbookCharts('packages', packages);
  expect(Object.fromEntries(chart.groups.map(group => [group.key, group.ids.length]))).toEqual({ complete: 1, partial: 1, none: 1, unknown: 4 });
});

test('balance breakdown uses only fields available to the viewer and keeps negative, missing and zero distinct', () => {
  const row = sourceRow(1, null, 'Session');
  expect(workbookCharts('payments', [row])).toEqual([]);
  const rows = [1200, 0, -500, null].map((value, index) => ({ ...sourceRow(index + 1, null, 'Session'),
    fields: [{ key: 'student_balance_minor', label: 'Reported balance', type: 'money' as const, value }] }));
  const [chart] = workbookCharts('payments', rows);
  expect(chart.groups.map(group => group.ids.length)).toEqual([1, 1, 1, 1]);
});
