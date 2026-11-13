import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import type { WorkflowOperationsData, WorkflowOperationsRecord } from '../../src/modules/workflow-import/operational-model';

const state = vi.hoisted(() => ({ data: undefined as unknown }));
// Supply the completed HTTP read; all schema validation and rendering remain real.
vi.mock('../../src/components/payments/shared', () => ({ usePaymentRecord: () => ({ data: state.data, reload: () => {} }) }));
import { WorkflowOperationsWorkspace } from '../../src/components/workflow-import/operational-workspaces';

const uuid = (n: number) => `d3c78931-96e2-4d52-9860-${String(n).padStart(12, '0')}`;
function sourceRow(n: number, date: string | null, title: string): WorkflowOperationsRecord {
  return { id: uuid(n), title, subtitle: 'Synthetic course', source_table: 'sessions', source_row: n + 1, reported_status: 'Completed', date,
    fields: [{ key: 'course', label: 'Course', value: 'Synthetic course', type: 'text' }], issues: [], actions: [],
    review: { version: 1, state: 'linked', can_review: false }, links: { learner_id: null, tutor_id: null, occurrence_id: null, package_id: null } };
}
function data(view: 'sessions' | 'overview' | 'payments', records: WorkflowOperationsRecord[]): WorkflowOperationsData {
  return { enabled: true, role: 'owner', mapping_options: { learners: [], tutors: [] }, sections: [{ key: view, title: 'Workbook records', description: 'Historical reports', metrics: [], records }] };
}
const render = (view: 'sessions' | 'overview' | 'payments', collapsed = false) => renderToStaticMarkup(createElement(WorkflowOperationsWorkspace, { view, collapsed }, createElement('button', null, 'Continue current workflow')));
beforeEach(() => { state.data = undefined; });

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
  expect(html).toContain('Saved detail 5');
  expect(html).toContain('Completed · reported');
  expect(html).toContain('fake providers');
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
