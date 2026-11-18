import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CohortReport, WorkloadReport } from '../../src/modules/analytics/queries';
import { AnalyticsWorkspace } from '../../src/components/analytics/workspace';

const response = vi.hoisted(() => ({ cohort: undefined as CohortReport | undefined, workload: undefined as WorkloadReport | undefined, paths: [] as string[] }));
vi.mock('../../src/components/payments/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/payments/shared')>();
  return {
    ...actual,
    usePaymentList: () => ({ items: [], reload: () => {} }),
    usePaymentRecord: (path: string | null) => {
      if (path) response.paths.push(path);
      return { data: path === null ? undefined : path.startsWith('analytics/workload?') ? response.workload : response.cohort, reload: () => {} };
    },
  };
});

const render = (view: 'students' | 'team') => renderToStaticMarkup(createElement(AnalyticsWorkspace, { view, asOf: '2026-11-18T10:00:00Z' }));
beforeEach(() => {
  response.paths.length = 0;
  response.cohort = {
    from: '2026-11-01', to: '2026-11-18', as_of: '2026-11-18T10:00:00Z', observation_days: 30, time_zone: 'Africa/Cairo',
    policy_version: 'first_eligible_v1', grain: 'learner', unlinked_inquiries: 3, next_cursor: null, items: [],
    summary: { learners: 10, interactions: 26, booked: 6, paid: 4, attended: 7, newly_taught: 2,
      returning: 4, unknown_history: 3, verified_campaign: 5, verified_organic: 2, unknown_source: 3, provisional: 8 },
    spend: { state: 'not_applicable', amount_minor: null, currency: 'EGP', basis: 'campaign_calendar_dates', cac_minor: null, entries: [] },
  };
  response.workload = {
    from: '2026-11-01', to: '2026-11-18', time_zone: 'Africa/Cairo', staffed_hours_state: 'unknown', staffed_response_seconds: null,
    tutors: [], conversations: [], next_cursor: null, tutor_next_cursor: null, conversation_next_cursor: null,
    summary: { scheduled_seconds: 5400, delivered_seconds: 7200, open_conversations: 8, unassigned_conversations: 3,
      answered_conversations: 4, total_response_seconds: 300, total_owned_seconds: 800 },
  };
});

test('initial query uses the server cutoff and starts at Cairo month opening across UTC midnight', () => {
  renderToStaticMarkup(createElement(AnalyticsWorkspace, { view: 'students', asOf: '2026-10-31T23:00:00Z' }));
  expect(response.paths).toHaveLength(1);
  const filters = new URL(response.paths[0], 'https://example.test/').searchParams;
  expect(filters.get('from')).toBe('2026-11-01');
  expect(filters.get('to')).toBe('2026-11-01');
  expect(filters.get('as_of')).toBe('2026-10-31T23:00:00Z');
});

test('initial learner report charts full-cohort counts for independent payment and attendance milestones', () => {
  const html = render('students');
  expect(html).toContain('20.0%');
  expect(html).toMatch(/Settled payment[\s\S]*?width:40%[\s\S]*?4 of 10/);
  expect(html).toMatch(/Approved attendance[\s\S]*?width:70%[\s\S]*?7 of 10/);
  expect(html).toMatch(/Unknown source[\s\S]*?width:30%[\s\S]*?3 of 10/);
  expect(html).toContain('30-day observation window');
});

test('empty cohort gives an explicit empty state and an unavailable conversion rate', () => {
  const summary = response.cohort!.summary;
  for (const key of Object.keys(summary) as (keyof typeof summary)[]) summary[key] = 0;
  const html = render('students');
  expect(html).toContain('No verified learner links match this cohort.');
  expect(html).toContain('Not calculable');
  expect(html).not.toMatch(/0\.0%|NaN|Infinity/);
});

test('team bars share a teaching-time scale and use all open conversations as the queue denominator', () => {
  const html = render('team');
  expect(html).toMatch(/Scheduled[\s\S]*?width:75%[\s\S]*?1h 30m/);
  expect(html).toMatch(/Delivered[\s\S]*?width:100%[\s\S]*?2h/);
  expect(html).toMatch(/Unassigned[\s\S]*?width:37.5%[\s\S]*?3 of 8/);
  expect(html).toContain('1m 15s');
  expect(html).toContain('Staffed-hours coverage is unknown');
});

test('empty support queue and missing response denominator stay explicit', () => {
  const summary = response.workload!.summary;
  for (const key of Object.keys(summary) as (keyof typeof summary)[]) summary[key] = 0;
  const html = render('team');
  expect(html).toContain('No conversations are currently open.');
  expect(html).toContain('Not calculable');
  expect(html).not.toMatch(/NaN|Infinity/);
});
