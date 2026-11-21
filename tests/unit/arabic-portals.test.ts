import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { PortalShell } from '../../src/components/portal-shell';
import { SiteLanguageProvider } from '../../src/components/site-language';
import { workbookCharts } from '../../src/components/workflow-import/record-insights';
import { WorkbookCharts } from '../../src/components/workflow-import/workbook-charts';
import { StudentGrades } from '../../src/components/quizzes/student-grades';
import type { WorkflowOperationsRecord } from '../../src/modules/workflow-import/operational-model';

vi.mock('server-only', () => ({}));
vi.mock('../../src/components/payments/shared', () => ({
  usePaymentList: () => ({ items: [{
    learner_id: 'private-learner', quiz_id: 'private-quiz', learner_name: 'Administrator',
    title: 'Session history', session_title: 'Current access', start_at: '2026-11-20T12:00:00Z', grade: null,
  }] }),
  PaymentReadState: () => null,
}));

function inArabic(children: ReactNode) {
  const props = { language: 'ar' as const, children };
  return renderToStaticMarkup(createElement(SiteLanguageProvider, props));
}

test('the Arabic owner sees translated administration, only the authorized workspace, and an English switch', () => {
  const html = inArabic(createElement(PortalShell, { kind: 'admin', account: {
      account_id: 'private-owner', verified: true, roles: ['admin'], locale: 'en', authorized_learner_ids: [],
    } }));
  expect(html).toContain('مسؤول النظام');
  expect(html).toContain('الصلاحيات الحالية');
  expect(html).toContain('طلبات الحصص');
  expect(html).toContain('English');
  expect(html).not.toContain('href="/learn"');
  expect(html).toContain('private-owner');
});

test('Arabic charts localize the month and preserve their source record selectors', () => {
  const row = { id: 'private-record', source_table: 'sessions', date: '2026-11-20', reported_status: 'Completed' } as WorkflowOperationsRecord;
  const charts = workbookCharts('sessions', [row], 'ar');
  expect(charts[1].groups[0]).toMatchObject({ key: '2026-11', ids: ['private-record'] });
  expect(charts[1].groups[0].label).toContain('نوفمبر');
  const html = inArabic(createElement(WorkbookCharts, { charts, selected: null, onSelect: () => {}, recordsId: 'records' }));
  expect(html).toContain('نتائج الحصص');
  expect(html).toContain('مكتملة');
  expect(html).not.toContain('Session outcomes');
});

test('grade labels are Arabic but the learner name and two user-authored titles stay as supplied', () => {
  const html = inArabic(createElement(StudentGrades));
  expect(html).toContain('بانتظار الدرجة');
  expect(html).toContain('Administrator');
  expect(html).toContain('Session history');
  expect(html).toContain('Current access');
});
