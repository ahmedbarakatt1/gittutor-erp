# T08 finance close and gross tutor obligations

Additive migration `20261113182100_finance_close_gross_obligations.sql` closes the bounded GT-807 and GT-1506 gaps. Original financial postings and statement comparisons remain immutable.

GT-807 retains an open variance, its owner and evidence. Closure requires clean private evidence, current administrator authority, a current-version check and actual later-posted source transactions for the same cash account whose effective time is within the original comparison. Their total must equal the original variance and the current ledger must equal the unchanged observed statement. The command records a resolution instead of changing the original comparison or posting a balancing amount. Later historical drift displays a reopened investigation. The Finance page exposes investigations, qualifying source postings and evidence-based closure.

GT-1506 sums actual earning, adjustment, settled payout and reversal postings by tutor before separating gross payable from advances. The existing net control remains visible alongside gross payable, tutor advances and any unattributed net amount. The Finance page provides each tutor balance and its ledger-entry drilldown.

| Case | Concrete regression | File |
|---|---|---|
| GT-807 | `GT-807 cash variance remains owned and open until referenced settled-source postings reconcile its original control` | `tests/integration/finance-report-controls.test.ts` |
| GT-1506 | `GT-1506 tutor advance10000 and another tutor payable45000 remain gross with exact ledger reconciliation` | `tests/integration/finance-report-controls.test.ts` |

The first regression additionally checks stable replay, current CS denial and immutable original facts. The second establishes Tutor A's 62,500 earned and 72,500 settled paid through an evidenced adjustment, alongside Tutor B's 45,000 earned and zero paid. It asserts gross payable 45,000, advance 10,000 and net 35,000 as separate figures.

Verification on 2026-11-13:

- Initial GT-807 RED reached the absent `list_cash_reconciliations` boundary.
- Staged SQL was validated in a rollback transaction before the additive migration was applied.
- `pnpm exec vitest run tests/integration/analytics.test.ts tests/integration/finance-report-controls.test.ts tests/integration/finance.test.ts tests/integration/finance-control.test.ts`: 4 files, 9 tests passed in 17.21 seconds. Both new finance regressions passed alongside existing close and finance controls.
- `pnpm exec playwright test tests/e2e/analytics.spec.ts`: 2 tests passed in 25.9 seconds. Both desktop and mobile render gross obligations and cash investigations without horizontal overflow.
- These focused command results were emitted directly in the agent tool transcript, not saved as standalone log files. Root owns the full independent release run and its logs.

Tests use real local ledger commands, private evidence bytes and the configured simulated scan/payout adapter. Production scanner and payout readiness remain explicit external dependencies; this evidence does not claim live settlement.
