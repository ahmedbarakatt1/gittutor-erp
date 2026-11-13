# T12 acquisition and workload

## Implemented contract

The application records immutable booking intent and customer support/WhatsApp observations. Booking intent uses the named enrollment learner. Support observations retain the original actor and source claim; they require the explicit T11 account/learner link or an administrator's evidenced identity review. A contact address or account alone never assigns an inquiry to a child. Link corrections append versioned reviews; source observations remain intact.

The cohort grain is one durable learner. Selection considers all eligible retained inquiry history before filtering the first inquiry's Africa/Cairo business date. Event time then inquiry UUID breaks ties. `first_eligible_v1` uses the first eligible observation; client source tokens remain unknown until reviewed against independent evidence. Campaign, verified organic and unknown credit are separate. Delayed earlier observations and evidence corrections append selection history. Recorded-as-of filters include source/link/review/approval observation times.

Every learner receives the same configured elapsed-day observation window (30 days by default, 1–365 permitted). Interaction totals count learner/inquiry pairs, so one inquiry explicitly linked to two children contributes one interaction to each child's history. Booking acceptance and net settled allocation are separate stages. Conversion requires the first lifetime approved completed-present attendance with positive participation, across all formats; paying or missing a session does not qualify. Unknown lifetime completeness is explicit and does not count as newly taught. An independently reviewed complete history permits complimentary attendance to qualify. Returning learners retain their original cohort. Format/subject filters affect progression and the first-attendance conversion must match the selected format/subject.

Campaign spend has dated non-overlapping periods, currency, required evidence, immutable original amounts and versioned corrections. An optional unique marketing expense link preserves ledger provenance without posting another operating expense. Missing, partial and known zero spend are distinct. CAC is unavailable with missing/partial spend, zero newly taught learners, or a subject/format subset without a corresponding spend basis. The UI states these definitions.

Tutor time counts distinct occurrences and uses approved actual duration for delivered time. Current weekly availability and dated exceptions determine capacity using Cairo instants. Support reports show elapsed first-human-response time, current waiting age, ownership transitions and elapsed ownership within the period. Staffed-hours coverage remains explicitly unknown because no staffing calendar is configured; no staffed SLA is fabricated. Paginated details retain totals for the full report.

## Boundaries and interfaces

- Admin: `/admin/campaigns`, `/admin/students`, `/admin/team`; finite `/api/v1/analytics` routes and strict response schemas.
- Database: `analytics_command`, `review_inquiry_link`, `list_campaigns`, `list_analytics_inquiries`, `get_cohort_report`, `get_workload_report_page`, `audit_cohort_export`.
- Customer service can query only currently owned conversation workload; acquisition, spend, tutor capacity and source reviews require a current admin role.
- Evidence uses the existing private upload/content/scan flow through the admin-only `analytics_evidence` action. Unscanned, unrelated and customer access is rejected.
- CSV exports retain the identical period, recorded cutoff, attribution and progression filters, use one row per learner, escape spreadsheet formulas, and require database reconciliation of row and newly-taught counts before a successful audited download. No tutor fee, margin, payout destination, note or credential is included in the cohort DTO.

## Acceptance mapping

| Case | Concrete test | File |
|---|---|---|
| GT-1001 | `GT-1001/1002/1507 lifetime first inquiry precedes Cairo period filtering; repeat contacts retain one learner` | `tests/unit/cohorts.test.ts` |
| GT-1002 | Same lifetime/Cairo cutoff test and the persisted sibling cohort regression | `tests/unit/cohorts.test.ts`, `tests/integration/analytics.test.ts` |
| GT-1003 | `GT-1003 ambiguous support contacts require explicit named-learner evidence and retain link corrections`; `GT-1003/1004/1507 persisted sibling cohorts use approved individual attendance, lifetime first touch and audited correction` | `tests/integration/analytics.test.ts` |
| GT-1004 | `GT-1004 replay and unapproved attendance cannot inflate conversions`; persisted sibling cohort regression | `tests/unit/cohorts.test.ts`, `tests/integration/analytics.test.ts` |
| GT-1005 | `GT-1005 returning, absent and unknown history are not new acquisition; complimentary present is` | `tests/unit/cohorts.test.ts` |
| GT-1006 | `GT-1006/1508 source claims stay unknown; verified organic never becomes paid campaign credit` | `tests/unit/cohorts.test.ts` |
| GT-1007 | `GT-1007 late events select one winner with stable timestamp/id tie and as-of reproducibility` | `tests/unit/cohorts.test.ts` |
| GT-1008 | `GT-1008 zero denominator and missing spend remain different from confirmed zero` | `tests/unit/cohorts.test.ts` |
| GT-1507 | Lifetime/Cairo unit regression and persisted sibling cohort regression | `tests/unit/cohorts.test.ts`, `tests/integration/analytics.test.ts` |
| GT-1508 | Source provenance unit regression | `tests/unit/cohorts.test.ts` |
| GT-1509 (shared with T10) | `GT-1509 conversion ratio recomputes from matching summed counts, not average percentages` proves 2/2 + 3/8 = 5/10; T10 owns occurrence-grain financial export checks | `tests/unit/cohorts.test.ts` |

The persisted attendance regression seeds explicitly isolated historical source facts and approvals in the guarded test database. T08's actual completion-command regressions remain the evidence for financial posting and approval transaction correctness. T12 never creates a payment event and calls it attendance.

## Verification record

- Initial unit RED: missing acquisition module; initial SQL RED: both analytics RPC tests failed at the absent boundary.
- `pnpm exec vitest run tests/unit/cohorts.test.ts`: 10 passed (2026-11-13).
- First `pnpm exec vitest run tests/integration/analytics.test.ts`: 2 passed after migrations `20261113175000` and `20261113175100`. Includes real PDF bytes, private Storage, fake scan, evidence selection, authorized download, denied learner access, immutable sources, idempotency/version conflict, spend correction, and unchanged expense ledger posting count.
- A first workload check exposed the retained 1,253-tutor test history. The additive pagination migration keeps full-report totals while returning bounded detail pages.
- Expanded identity RED reproduced an authenticated support contact being assigned to a learner without named-learner evidence. Additive migration `20261113182000_analytics_verified_learner_links.sql` corrected the source boundary, retained historical observations and introduced append-only link reviews. The same migration requires a completed occurrence and matching first-attendance subject/format for filtered conversion.
- Final `pnpm exec vitest run tests/integration/analytics.test.ts tests/integration/finance-report-controls.test.ts tests/integration/finance.test.ts tests/integration/finance-control.test.ts`: 4 files, 9 tests passed in 17.21 seconds (2026-11-13). The analytics file contains 4 passing tests, including Cairo midnight, two named children, unknown-history review, complimentary attendance, replay, once-per-occurrence time and exact export reconciliation.
- Final `pnpm exec playwright test tests/e2e/analytics.spec.ts`: 2 tests passed in 25.9 seconds, covering desktop and mobile. Actual UI creation, campaign pagination, matching zero-row CSV, current-role denial, team totals and both finance controls passed. Both layouts had no horizontal overflow.
- Official Playwright CLI 0.1.24 with Microsoft Edge separately inspected `/admin/campaigns`; final console `.playwright-cli/console-2026-11-13T15-48-15-960Z.log` contains no warnings or errors. Local screenshots: `.local/screenshots/t12-campaigns-cli-desktop.png`, `.local/screenshots/t12-campaigns-cli-mobile.png`, `.local/screenshots/t12-team-desktop.png`, `.local/screenshots/t12-team-mobile.png`. The narrow campaign capture shows the existing navigation stacked above the page; the automated mobile flow exercises the forms below it.
- The focused test runs above emitted results directly in the agent tool transcript; they were not redirected to standalone test log files. Root owns the independent complete-release logs and execution statuses.
- Self-review checked current admin authorization, private scanned evidence, immutable correction lineage, named learner identity, bounded detail pagination, first lifetime attendance filtering, strict DTOs and row/headline reconciliation. No additional release-critical defect remained in this bounded slice.

The SQL attendance fixture is historical source evidence, not a full re-run of every teaching command. Unit cases cover late-arrival ordering, returning/no-show classification and mixed-ratio aggregation; the database tests cover persistence and authorization. Live provider checks are not represented as passed by these local tests.

## Live-provider readiness

Analytics itself has no external provider. WhatsApp source authenticity depends on T11's verified ingress adapter and operational live account checks. Local file-scan tests use the explicitly simulated scanner; production scanner readiness remains T07's release dependency. No live campaign source is declared verified without an administrator's saved evidence review.
