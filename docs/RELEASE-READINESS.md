# Release readiness

## Current decision

**Production preparation —14 November2026; activation not approved yet.** Actual workbook history is integrated into the main role workspaces, with complete fake-provider preview journeys previously executed. The temporary laptop preview requires its services running; historical URL checks do not attest current uptime. Portable non-root web/worker images and isolated packaging smoke checks now pass. Both service CLI sign-ins work. The dedicated Vercel project is created/configured but has no deployment. Commercial-plan/budget selection, Supabase organization/target selection, permanent URL, live providers, commercial approval, hosted recovery and remaining acceptance variants remain open. Supabase's separate app connector still requires reauthentication.

The application includes the public site and learner/guardian, tutor, customer-service and admin workspaces. Its private actual-data preview uses imported history and separate fictional practice transactions; ordinary regression suites use synthetic identities. Live activation must use a clean hosted target and reviewed real-record cutover, never a preview dump. Tutor compensation remains privileged. The supplied contact and Instagram logo/design are incorporated.

Latest production preparation: Docker web/worker builds and4 isolated image checks passed. After the final RPC-boundary correction,394 unit tests and whole lint/types passed;6/6 focused unit/actual-PostgreSQL checks also passed. Dependency audit found0 advisories across178 production/optional dependencies. Clean CI run43581649382 passed295/296 integration tests after fixing initialization; the final stale owner assertion was corrected and its focused check passed. Full rerun and final totals will be recorded in [implementation status](IMPLEMENTATION-STATUS.md). No all-green remote release is claimed yet.

Subsequent CI43583823884 passed setup/static checks but stopped at393/394 units on a random UUID substring false positive in the Google privacy test. A deterministic reproducer failed locally; an exact allowed-payload assertion plus private input sentinels passed5/5 focused calendar checks. The next full run must supply its own integration/browser result.

CI43584368137 then passed394/394 units and297/297 real-database integration checks. Browser result86 passed/70 failed/2 gated demo skips: shared sign-in assertions still expected the account UUID card removed from operational dashboards. The repaired setup checks server-authenticated identity directly; exact roles/scopes and confidentiality checks remain. Five focused role/guardian/logout/application browser checks passed locally. Full browser verification and later build/release steps remain pending the next run.

After that repair, the full local browser run completed152 passed/4 failed/2 gated skips. The four failures came from two section selectors on both viewports; their corrected checks passed. A separately reproduced history-loading input reset is fixed with a new desktop/mobile regression. The focused repair run passed6/6, including all four failed cases and both new regressions. Whole lint/types, both rebuilt Docker targets and4/4 isolated image checks passed afterward. CI43591976383 on the earlier7344796 revision passed static/unit/database stages and browser155/158, with1 unavailable-response-body failure in the same remounting transfer workflow and2 gated skips. Commitff9399c preserves the workflow subtree and requests across history reads. Full CI43594506569 is executing that correction; no complete release-gate claim follows from combining earlier runs.

CI43594506569 subsequently stopped at393/394 units on the stale assertion expecting unconditional fake-provider copy. The revised assertion preserves history separation and rejects that misleading production claim. Focused5/5 and whole394/394 unit checks plus scoped ESLint passed locally; no application change was needed. The remote integration/browser/build stages did not execute on that run. The next complete run remains the release gate.

The Vercel transport follow-up preserves the file limits through3MiB authenticated pieces and streamed downloads/exports. Actual25MiB Storage validation, corrupt/interrupted retry, durable cleanup candidates, scan denial and unrelated-account denial are covered. Latest local whole units398/398, lint/types exit0, file/CRM/analytics browsers8/8 plus strengthened lost-acknowledgement desktop/mobile2/2. Independent final review reports no remaining concrete findings. A Linux local Vercel build passed on the preceding8b673d1 source; the updated build and full remote gate must be recorded separately. No hosted upload/deployment is claimed.

The updated Linux Vercel build subsequently passed, including optimized compilation/types/static generation and actual Build Output API packaging. File/export/analytics entries all declare Node24.x response streaming. This resolves the local host-build check; deployed payload behavior still requires its own pilot.

## Earlier executed release checks —13 November2026

| Check | Latest recorded result | Evidence |
|---|---|---|
| Whole unit suite |347 passed, 47 files, 43.86s |`.local/release-units-final.log`|
| Whole ESLint |Passed |`.local/release-lint-final.log`|
| TypeScript |Passed |`.local/release-types-final.log`|
| Pack structure |Passed,147 cases/84 original IDs/18 requirements/13 tasks |`python tools/verify-pack.py`|
| Acceptance evidence validator |Valid;0 recorded passed/147 not_run |`pnpm exec tsx tools/validate-evidence.ts fixtures/acceptance-cases.json`|
| Combined real-database regression, including T04–T06 |First run 273/279; second run 277/279. Both remaining failures repaired; 11/11 payroll/finance/analytics checks and 2/2 finance-control checks passed afterward. All 280 distinct implemented integration checks have passing executions across these runs; no single clean full rerun is claimed |[Second full run](evidence/release-integration-second.log), [11-check repair](evidence/release-clock-fixes-green.log), [finance controls](evidence/release-finance-controls-final.log)|
| Complete desktop/mobile browser suite |First run147/156 passed; all9 failed cases and3 adjacent checks passed in12/12 repair run,5.8m. All156 distinct checks now have passing executions |`.local/release-browser-first.log`, `.local/release-browser-repairs.log`|
| Database/grant verification |Passed 147 migrations, 232 private RLS tables, 709 function boundaries; native foundation 7 tables/5 functions also passed |[Verification log](evidence/release-db-verify-final.log)|
| Production build |Passed after both customer-bundle repairs; optimized compilation, TypeScript and 59 generated pages |`.local/release-build-final.log`|
| Isolated database/private-file restoration and replay |Passed again after the payout correction: 232 business tables/141 files, 39.732s; prior outcomes retained |[Recovery log](evidence/release-recovery-final.log); ignored manifest run `6e9f8131-36e8-4222-bfbc-774115a983b4`|
| Worker startup with registered adapters |Passed with `WORKER_PURPOSE=verification.no_jobs` and `--once`; all 11 handlers registered, external providers simulated |[Worker log](evidence/release-worker-final.log)|
| Preview and synthetic accounts |Public home, subjects and login HTTP 200; actual authentication/current role checks passed for all five demo accounts |[Preview check](evidence/release-preview-final.log)|

Focused domain evidence is linked from [implementation status](IMPLEMENTATION-STATUS.md), [CRM](T10-CRM-EVIDENCE.md), [support](T11-SUPPORT-EVIDENCE.md) and [analytics](T12-ANALYTICS-EVIDENCE.md). Tests use actual authentication, SQL transactions and private Storage while substituting only external provider calls. Screenshots and inspection logs distinguish real workflows from mocked error-state checks. The acceptance catalogue remains separate: an automated suite pass never promotes an unexecuted literal variant to passed.

The second full regression exposed an actual payout race: a transaction that began earlier could acquire the lock later, then exclude the winning reservation using its transaction-start timestamp. Additive migration `20261113185000_payroll_current_reservation_cutoff.sql` uses the current database clock for command balance checks after locks; explicit historical report cutoffs remain intact. A deterministic older-transaction regression failed before the correction and passed afterward. The analytics failure was a test cutoff sampled with a client millisecond clock immediately after a database approval; the test now samples database microseconds after the commit. Original failed logs remain available. See PostgreSQL's [current-time semantics](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT) and [function snapshot semantics](https://www.postgresql.org/docs/17/xfunc-volatility.html).

## Acceptance coverage limits

All 147 entries are mapped across [T01–T06](T01-T06-ACCEPTANCE-MAP.md), [T07–T09/T13](T07-T09-T13-ACCEPTANCE-MAP.md) and the T10/T11/T12 evidence documents. These maps distinguish exact assertions from related coverage and provide procedures for missing literal variants. Remaining local acceptance work includes exact cutoff boundaries, some multi-party race/financial-value variants, a restored uncertain real payout scenario and selected combined portal/email journeys. These are not external-credential dependencies and are not marked passed. Local exploratory testing readiness does not close the complete T13 acceptance gate.

The local restoration used a separate database in the existing container plus a new private bucket, with repeatable-read table controls, per-object SHA-256 comparisons and current authorization checks. It preserves source and failed target data. It verifies generic durable-job reconciliation without redispatch; it does not attest an external provider's uncertain payout outcome or a separate hosted-project restoration.

## External activation dependencies

| Area | Local implementation | Exact next controlled check |
|---|---|---|
| Hosted Auth/database/private Storage |Real local Supabase and current-role boundaries |Provision isolated staging, apply migrations without synthetic records, configure allowed redirects/SMTP, repeat separate-role and signed-file revocation checks.|
| Commercial policies |Draft authoring, publication validation, synthetic approved examples |Owner approves complete cancellation, expiry, amendment, refund and fee rules; publish an approved policy and complete a controlled booking.|
| Incoming/outgoing payments |Manual evidence reconciliation, allocations, refunds, payout reservations |Verify real receiving accounts and payout destinations; reconcile one controlled settled incoming transfer, refund and tutor payout to independent statement evidence.|
| Google Calendar/Meet |Fake adapter, OAuth/PKCE, encrypted credentials, retry/reconciliation |Connect approved organizer; create/reschedule/cancel a controlled event and verify external learner admission, tutor hosting and removal of access.|
| Email |Fake local inbox, SES adapter, signed callback processing |Verify sender/region/SNS topic; deliver to controlled addresses, receive signed delivery/bounce events and verify current-recipient withdrawal. Test Auth SMTP separately.|
| WhatsApp |Fake adapter, signed webhook, FAQ, ownership, consent/window/template controls |Configure the approved business/phone IDs, token, secret, graph version and templates; test inbound, human handoff, opt-out, expired window and approved-template delivery.|
| Malware scanning |Isolated fake and ClamD protocol adapter |Provide private scanner with current signatures; verify safe content accepted, malicious content quarantined and outage blocks downloads.|
| Hosted recovery/operations |Local isolated rehearsal runner and durable replay |Approve retention/RPO/RTO/operator; restore into a separate hosted project, recover object bytes and encryption material, reconcile controls and measure recovery.|
| CI/deployment |Pinned workflow and separate web/worker process definitions |Execute the workflow on the remote host, deploy staging and record its role, browser, provider and recovery results.|

No live provider pilot or production deployment is claimed. Hosted CI execution and its failures/repairs are recorded above and in implementation status; remote CI is not a hosted application/provider pilot. See [local testing instructions](LOCAL-TESTING.md) and [deployment instructions](DEPLOYMENT.md).
