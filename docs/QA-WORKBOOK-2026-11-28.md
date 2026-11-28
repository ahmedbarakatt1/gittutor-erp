# Website testing workbook, 28 November 2026

The supplied workbook contains 255 cases. This cycle addressed the 44 cases without a previous pass and all seven previously unrun journeys. The updated workbook has 251 passes and four blocked cases. Of the passes, 211 retain the original tester’s evidence. All 43 journey steps passed against the guarded local application, database and synthetic providers. The signup-closure case was also exercised on the hosted testing site.

## Case results

| Case | Result | Observed outcome | Executable evidence |
|---|---|---|---|
| GT-AUTH-004 | Pass | Repeated incorrect passwords reached HTTP 429 and displayed retry guidance. After expiry the same login was checked again and rejected with HTTP 401. Desktop and mobile passed. | tests/e2e/password-login-limit.spec.ts |
| GT-AUTH-006 | Pass | The testing site reported closed signup. Chromium submitted a fresh reserved synthetic address and received HTTP 400 with a visible form error. A more specific invitation message is included in the patch. | Hosted signup form and Auth settings readback |
| GT-STU-017 | Blocked | Private upload, authenticated file reads and Drive assignment/revocation behavior passed against the local fake. This run did not verify a real tutor opening and subsequently losing access to a production Drive file. | tests/integration/request-drive-materials.test.ts; tests/integration/workbook-individual-journey.test.ts |
| GT-STU-023 | Pass | Reserved each published synthetic offering through local authenticated booking commands. The four quotes contained EGP 650, 575, 550 and 500 respectively, with no tutor fee, compensation or margin fields. New private sessions use the 90-minute tariff, and historical EGP 500 bookings retain their accepted terms. | tests/integration/portal-journeys.test.ts |
| GT-STU-030 | Pass | Desktop Chromium applied a single Cairo date to two real adjacent bookings. The genuine API returned one result per page and a cursor. Clicking Load more results showed both bookings within the selected date, and an empty period cleared them. Unit tests verified 23-hour and 25-hour Cairo dates. | tests/e2e/booking.spec.ts; tests/unit/booking-scheduling.test.ts |
| GT-STU-036 | Pass | Learner declined the reviewed transfer proposal. Original funded booking remained confirmed; provisional destination cancelled and original payment/quote remained intact. | tests/integration/enrollment-transfer-boundaries.test.ts |
| GT-STU-037 | Pass | Learner requested a move to another occurrence of the same offer. No destination enrollment existed before admin review; staging the destination kept the existing confirmed enrollment and charge. | tests/integration/enrollment-transfer.test.ts |
| GT-STU-062 | Blocked | Local organizer and booking tests used the simulated adapter. Actual Google Meet admission requires a currently authorized live pilot booking, organizer and learner at the session start. No live participant joined in this run. | tests/e2e/teaching-retests.spec.ts, GT-ADM-120 |
| GT-STU-063 | Pass | After a historical synthetic booking ended, the learner opened Meeting access and saw “This session is no longer open for joining.” The panel had no Join or Preview button. | tests/e2e/session-completion.spec.ts, desktop Playwright |
| GT-STU-064 | Blocked | A simulated room cannot establish Google Meet duration. A live organizer and tutor plus at least three authorized learners must sustain a 90–105 minute call. No such call was placed in this run. | tests/e2e/teaching-retests.spec.ts, GT-ADM-120 |
| GT-STU-080 | Pass | The actual signed-in learner Packages page displayed the exact empty-catalog message and no purchase button when its contract-list response was empty. Playwright scoped the empty response to this browser so existing approved synthetic contracts were preserved. | tests/e2e/packages.spec.ts (GT-STU-080) |
| GT-STU-082 | Pass | A package remained pending when one minor unit short; final verified allocation activated its purchased credits with one grant lot and funding lineage. | tests/integration/package-activation.test.ts |
| GT-STU-084 | Pass | Accepted unpaid hold released once; original EGP 500 charge retained with a linked credit and zero remaining due. Package-backed hold restored 1,000 reserved quanta and its EGP 500 carrying value. A partially paid hold still required a remedy. | tests/integration/temporary-seat-and-review.test.ts |
| GT-STU-100 | Pass | Signed-in learner opened an inbox containing a real support escalation ID with the historical UUID variant. Authenticated HTTP pages each returned 200 for the support, confirmation and payment records, with the learner portal link and no peer/private fields. Desktop Chromium rendered the inbox. The recipient pagination index prevents a separate timeout on large histories. | tests/unit/notification-event-id.test.ts; tests/e2e/notifications.spec.ts |
| GT-STU-101 | Blocked | Local automatic funding confirmation now creates and dispatches the learner email with a bookings link and no attachments. The isolated inbox captured it with the correct recipient. The workbook explicitly requires delivery to a live mailbox and that remains unverified. | tests/integration/confirmation-reminder-email.test.ts |
| GT-STU-102 | Pass | A funded, confirmed booking scheduled reminders exactly 24 hours and one hour before start. Rescheduling suppressed both old recipients and queued both correct new times. Advancing only those test jobs delivered both replacement messages to the isolated learner email inbox. | tests/integration/confirmation-reminder-email.test.ts |
| GT-GRD-003 | Pass | An unlinked account opened /learn, reached its own payments workspace, saw guidance on accepting a learner invitation, and had zero authorized learners in the account response. | tests/e2e/role-access.spec.ts |
| GT-PAY-003 | Pass | A guardian and staff prepared a two-learner plan; staff saw that it awaited the outside payer’s consent after reload. The payer accepted the exact terms. Staff then allocated once to each approved target, with zero unapplied cash, closed the review, and activated both purchases. | tests/e2e/payments.spec.ts (two-learner plan) |
| GT-PAY-004 | Pass | Source payer accepted the exact carryover terms, cross-account consent was refused, and the admin used the consent on final enrollment transfer. | tests/integration/enrollment-transfer.test.ts; tests/integration/enrollment-transfer-security.test.ts |
| GT-PAY-005 | Pass | Former guardian lost access to the learner’s enrollment, files, and charge instructions. After signing out and signing back in with no current roles, the browser opened Payments, showed the verified payer’s EGP 100 transfer and omitted learner, recipient-account and external statement identities. | tests/e2e/payments.spec.ts (former guardian) |
| GT-TUT-004 | Pass | Removing the weekly hours covering the synthetic tutor’s reserved lesson returned HTTP 409. The tutor saw the affected session link and Cairo time; all seven saved weekly intervals remained unchanged. A dated exception also refused the same lesson. | Hosted signup form and Auth settings readback |
| GT-TUT-005 | Pass | Two funded seats were confirmed after a third learner released their hold. The authenticated tutor schedule returned only the two confirmed learners. The administrator retained the cancelled enrollment in history. Tutor session detail rendered the room and material workspace. | tests/integration/teaching-roster-and-conflict.test.ts and tests/e2e/session-completion.spec.ts |
| GT-TUT-010 | Pass | A tutor signed in to a past confirmed lesson, recorded actual start and end, marked attendance with 3,600 seconds and submitted. The tutor saw Awaiting approval. | tests/e2e/session-completion.spec.ts, desktop Playwright |
| GT-TUT-013 | Pass | Following approved group delivery, the tutor published a shared summary and named feedback. The learner saw both in their booking. The integration read for classmates included the summary and excluded the named feedback. | tests/e2e/learning-records.spec.ts and tests/integration/learning-records.test.ts |
| GT-TUT-017 | Pass | Original and replacement tutors accepted their scoped agreement terms with separate learner consent before admin approval. | tests/integration/tutor-reassignment.test.ts |
| GT-CS-034 | Pass | Renewing a near-expiry claim extended its deadline. Another expired claim left the previous owner’s claimed list, appeared unassigned with empty owner/expiry, and was reclaimed at the displayed version. | tests/integration/temporary-seat-and-review.test.ts |
| GT-CS-035 | Pass | Desktop staff submitted a synthetic statement for 2026-11-01 through 2026-11-28. The form sent date-only values and displayed confirmation after HTTP 202 with a validation job. The separate byte-backed worker tests validated CSV candidates and duplicate handling. | tests/e2e/payments.spec.ts (GT-CS-035); tests/integration/statement-import-worker.test.ts |
| GT-ADM-001 | Pass | A signed-in synthetic workbook owner saw the two imported session outcomes in the business overview and the link to the request queue. | tests/e2e/role-access.spec.ts |
| GT-ADM-002 | Pass | Selecting Completed retained the existing search and showed only the matching source record on the overview. | tests/e2e/role-access.spec.ts |
| GT-ADM-021 | Pass | Scheduling an overlapping lesson returned HTTP 409 with its existing occurrence ID. The admin form showed a link to that session and its Cairo date and times. | tests/e2e/booking.spec.ts, GT-ADM-021 |
| GT-ADM-028 | Pass | Three confirmed seats each totalled EGP 550 (EGP 1,650 overall). Each original EGP 575 cash source retained EGP 550 allocated and EGP 25 available. Original commitments and the amended roster persisted. All five cash, named-coverage, debit, decline and expiry variants passed with isolated learner fixtures. | tests/integration/funded-amendments.test.ts |
| GT-ADM-031 | Pass | Reassignment committed after all affected parties consented. Tutor assignment history showed the old inactive and new active tutor, and private material access moved with the assignment. | tests/integration/tutor-reassignment.test.ts |
| GT-ADM-032 | Pass | The selected future occurrence received and applied the proposal. Its charges remained intact and the completed occurrence stayed identical. | tests/integration/teaching-operations.test.ts |
| GT-ADM-040 | Pass | The admin reviewed the same synthetic lesson and approved it. The ledger recorded exactly one EGP 250 base earning and EGP 500 in tuition revenue. The learner view used a scoped projection. | tests/e2e/session-completion.spec.ts, desktop Playwright |
| GT-ADM-111 | Pass | The owner searched and filtered the source archive, inspected row 2, then reviewed its links in the business overview. The saved link version advanced to 2 and the original snapshot remained identical. | tests/e2e/role-access.spec.ts |
| GT-ADM-120 | Pass | A connected simulated organizer showed its mode and an empty verification history. Recheck created, reconciled and closed a simulated room. The Cairo timestamp survived a page reload and the organizer remained labelled Simulated. | tests/e2e/teaching-retests.spec.ts, GT-ADM-120 |
| GT-ADM-130 | Pass | Desktop Chromium forced a definitive local email failure, selected the Failed status in admin operations, submitted a reason and queued one retry. The worker sent the retry. The independent unknown-send test rejected a blind retry. | tests/e2e/notifications.spec.ts; tests/integration/notifications.test.ts |
| GT-SEC-003 | Pass | An admin without a learner profile visited /learn, /learn/files and a request link. All returned the admin dashboard. Account readback contained only admin and no authorized learners. | tests/e2e/role-access.spec.ts |
| GT-SEC-010 | Pass | On one group booking, the learner, guardian and distinct responsible payer each reviewed their own scoped payment email in the isolated inbox and downloaded the actual private CSV. A synthetic payment event exercised routing against the booking’s real charge. Peer CSV requests were rejected and no peer enrollment appeared in the authorized CSVs or email. No external email was sent. | tests/integration/group-notification-export.test.ts |
| GT-CON-002 | Pass | After an approved, consented reschedule issued a new quote, attempting to accept the prior quote with its original hash/version returned VERSION_CONFLICT. | tests/integration/operation-proposals.test.ts |
| GT-CON-003 | Pass | The worker marked the first offer expired, replayed without duplication, and issued the only live offer to the next learner. The first learner’s stale quote returned WINDOW_CLOSED; the next learner accepted the new quote. The two-browser walkthrough also passed and opened the promoted learner’s exact seat. | tests/integration/booking-due-worker.test.ts |
| GT-CON-004 | Pass | Two independent Chromium sessions attempted to use the same remaining 1,000 quanta on different seats. One received HTTP 201, the other 409; database verified one reservation, 1,000 reserved and zero available. An independent SQL-connection race also passed. | tests/e2e/packages.spec.ts (same final package credit); tests/integration/package-booking-atomicity.test.ts (GT-CON-004) |
| GT-CON-008 | Pass | Settled EGP 500 stayed available to its verified payer. Allocating it to the expired hold returned WINDOW_CLOSED both before and after the expiry worker processed the hold; no seat confirmation or allocation. | tests/integration/temporary-seat-and-review.test.ts |
| GT-CON-009 | Pass | Created a 105-minute booking using 23:30–24:00 and 00:00–01:15 Cairo availability on successive dates. Removing the second date was rejected. The learner, assigned tutor and admin each saw both dates and the correct times in desktop Chromium. | tests/e2e/booking.spec.ts |

## Connected journeys

| Journey | Steps | Test |
|---|---:|---|
| J1 Individual request to tutor payout | 15 | `tests/integration/workbook-individual-journey.test.ts` |
| J2 Group of two booked by a guardian | 7 | `tests/integration/guardian-and-package-journeys.test.ts` |
| J3 Waitlist promotion | 4 | `tests/integration/portal-journeys.test.ts` |
| J4 Cancellation and refund | 5 | `tests/integration/guardian-and-package-journeys.test.ts` |
| J5 Package purchase and use | 4 | `tests/integration/guardian-and-package-journeys.test.ts` |
| J6 Tutor onboarding | 4 | `tests/e2e/teaching-retests.spec.ts` |
| J7 Support handoff | 4 | `tests/integration/portal-journeys.test.ts` |

The booking tests used real local authentication, database commands and ledger postings. Calendar rooms, mail, scanning and settlements used synthetic providers or evidence. The delivery journeys moved the isolated occurrence clock to reach the join and completion windows. The empty-package test supplied an empty list response to the browser.

## Bug log

The 13 original findings each have a passing retest. Further checks uncovered missed automatic confirmation notifications, slow inbox pagination, valid sessions refused at midnight, chart selections clearing existing filters, missing guidance for unlinked accounts, and incomplete review forms. The spreadsheet dashboard also counted only the first 79 cases. The updated workbook includes the additional findings, original source evidence, new results and corrected dashboard totals.

## Reproduce locally

Use the repository’s guarded local environment and seed workflow. See the cited case files for the exact role, fixture and assertions. No test requires real customer records.

```powershell
pnpm exec tsx tools/supabase-local.ts migrate
pnpm exec tsx tools/supabase-local.ts seed
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
python tools/verify-pack.py
```
