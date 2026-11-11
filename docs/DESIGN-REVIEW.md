# Git Tutor design record

## Scope and source

The T01 public shell follows `docs/07-ui-spec.md`, the supplied product copy and confirmed public group prices. The original preview and approved logo are absent. The text wordmark is the specified development fallback. No testimonials, learner totals, tutor biographies, availability claims or payment destinations are invented.

Loaded skills:

- `C:/Users/barak/.codex/skills/design-taste-frontend/SKILL.md`, exact-name upstream revision `3c7017d636c3a4aad378433ea6d0cfa6c921da4a`.
- `C:/Users/barak/.codex/plugins/cache/openai-curated-remote/impeccable/4.3.1/skills/impeccable/SKILL.md`, version 4.3.1, including new-work and craft-floor references.
- `C:/Users/barak/.agents/skills/playwright-cli/SKILL.md`, official CLI 0.1.24.
- `C:/Users/barak/.codex/skills/img2threejs/SKILL.md`, version 2.0.1; bounded accent implemented with the reference and render limitations below.

The product and visual requirements were supplied in the implementation pack. They control the work; no additional design approval is introduced. This is an extension of those requirements, not a new brand direction.

## Art direction

Reading this as a university tutoring landing page with a direct editorial language. The public page makes the student's own course material the starting point, then helps them choose a subject and understand private versus small-group learning. Taste dials: design variance 6, motion intensity 3, visual density 4.

The approved starting palette remains brand red `#CF302F`, ink `#202121`, warm ivory `#F8F6EF`, surface white, yellow accent `#F9CB49` and border `#DDD9D0`. The layout uses an asymmetric introduction, a working educational demonstration, subject rows, a compact tuition comparison and native FAQ disclosure. Typography and content do the work; there are no decorative statistics, fabricated testimonials or simulated operational dashboards.

The study example demonstrates binary search with actual state transitions and labeled example data. It is educational content, not a claim that a particular tutor or session is available. Its controls remain independent of booking.

Public navigation targets existing sections. Operational portal controls will appear with their owning milestones and real authorization/transaction boundaries. Customer surfaces never import the internal pricing-authoring manifest.

Customer pages use generous line lengths and plain-language amounts. The later CS/admin interfaces should use Impeccable's Operate mode: compact task queues, explicit ownership, visible state and period labels, and safe scoped drilldowns. Tutor compensation belongs only on separately authorized tutor/admin surfaces.

## Accessibility and responsive contract

- Semantic headings, landmarks, native buttons, links and disclosures; a skip link and visible focus.
- At least 16px body copy; logical CSS properties and a locale dictionary.
- Single-column reading order at 360px, no clipped money amounts or page overflow.
- Motion restricted to interaction feedback and disabled when reduced motion is requested.
- Educational interaction status announced through a live region.
- Browser verification must include desktop and 360px mobile, keyboard, console, network and sensitive-field inspection.

## Verification record

2026-11-11: Impeccable mechanical source detector executed after implementation:

```powershell
& 'C:\Users\barak\.codex\plugins\cache\openai-curated-remote\impeccable\4.3.1\skills\impeccable\scripts\impeccable.cmd' detect --json src/app/page.tsx src/app/layout.tsx src/app/globals.css src/components/study-example.tsx
```

Exit 0; result `[]` (no mechanical source findings). This is a source audit, not a rendered-browser or acceptance pass.

Executed on 2026-11-11:

- `pnpm test:e2e tests/e2e/smoke.spec.ts`: **10 passed (17.0s)**, exit 0. Both desktop and 360px projects checked real navigation targets, supplied public tuition, absence of confidential field names in HTML, binary-search transitions, native FAQ, keyboard skip-link focus, body sizing, horizontal overflow, RTL layout, and lazy 3D loading.
- `pnpm typecheck`: exit 0 after the accent was implemented. The coordinating agent subsequently executed `pnpm check`: lint, typecheck, 46 unit tests, 14 integration tests, 10 browser tests and production build all passed, exit 0.
- Official Playwright CLI 0.1.24, named session `git-tutor-ui`, browser `msedge`: desktop 1440px, mobile 360px, RTL mobile and 720px reflow captured and inspected. Console inspection found **0 errors and 0 warnings** after the favicon fix. Current application, font and lazy 3D requests returned HTTP 200 and remained local. No live provider calls were made.
- Captures: `.impeccable/review/desktop.png`, `mobile.png`, `mobile-rtl.png`, `reflow-720.png`, and `footer-accent.png`. Capture script: `.impeccable/final-review.code.txt`. The 720px view is a reflow check, not evidence of actual browser 200% zoom.

Review fixes: supplied a local text favicon to remove its initial 404; raised paragraph copy to the specified minimum; retained logical CSS and visible keyboard focus; made all navigation targets resolve; made the nonessential WebGL accent static, lazy and resilient to loading/context failure. The final mobile and footer captures were visually reviewed: text and tuition fit, controls remain readable, and the accent stays subordinate to the footer action. Development screenshots contain Next.js's development indicator; it is not application UI.

Earlier setup attempts are not acceptance failures or passes: the first test command was cancelled during dependency bootstrap, with no tests executed; the next failed because Chromium was absent. `pnpm exec playwright install chromium` completed, and subsequent browser runs passed (initially 6 tests, then the final 10).

This is T01 public-shell evidence. Full GT-1601 acceptance, real 200% zoom, complete accessibility/release audits, role-specific portal journeys and booking walkthroughs remain with later milestones. No booking functionality is claimed by this shell.

## Bounded tourism accent

Implemented a small, decorative Giza-inspired limestone sculpture in `src/components/giza-accent.tsx` and `src/components/giza-model.ts`. It is loaded near the footer, uses no animation loop or interaction listeners, is hidden from assistive technology, and caps pixel density at 1.5. The actual browser render contains 18 courses and 216 triangles. The typed model factory owns named parts and resource disposal. It is a stylized study of the reference, not an archaeological reconstruction.

Reference: [Kheops-Pyramid.jpg by Nina Aldin Thune, March 2005](https://commons.wikimedia.org/wiki/File:Kheops-Pyramid.jpg), used under [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/). Provenance and observed/inferred features are recorded in `.img2threejs/reference-analysis.md`; the downloaded reference is development evidence, not a shipped photograph. Source installation was used because the official img2threejs CLI documents Windows as unsupported.

Evidence: `.img2threejs/state.json`, `assessment.json`, `giza-sculpt-spec.json`, `reference-admission.json`, `material-report.json`, generated factory evidence in `generated/createGizaModel.ts.txt`, and `.img2threejs/review/angle-0.png`, `angle-90.png`, `angle-180.png`, `angle-270.png`. The application uses the lean typed factory above; the generic generated factory is retained only as evidence. Solid matte material is intentional; extracted photographic maps are not loaded by the app.

Executed checks: reference admission passed; strict sculpt-spec validation passed; extracted material confidence was 0.829; the four-angle turntable gate passed with no missing azimuths, detected holes or collapsed views; multi-angle diagnostics reported nondegenerate views. The reference/render interior-difference measurement was 0.1791 and is a measurement, not a quality pass. Render inspection confirmed a coherent stepped silhouette and visible course structure. Final browser checks verified deferred initialization and a rendered canvas.

**Full img2threejs photo-fidelity acceptance is incomplete.** The following executed diagnostic returned `passed: false`:

```powershell
python C:\Users\barak\.codex\skills\img2threejs\forge\stage4_review\diagnose_render.py --reference .img2threejs/references/kheops-pyramid.jpg --render .img2threejs/review/angle-0.png --spec .img2threejs/giza-sculpt-spec.json --pass-id blockout --in-place --json
```

Measured silhouette IoU 0.299 (required 0.85), aspect-ratio delta 0.3451 (limit 0.05), scale delta 0.4595 (limit 0.08); a map-stripped comparison render was also absent. The photo has scenery and a different camera/framing from the bounded stylized miniature. These failures are retained; no staged pipeline completion, fabricated review score or full reference match is recorded. The state deliberately remains active. Final mesh self-intersection, attachment-anchor, part-coverage and complete staged emission gates have not been executed. The accent has bounded application-render evidence, while those skill-specific quality gates remain open.

## T02 identity and portal review — 2026-11-11

The identity surfaces extend the existing red/ink/ivory world. Impeccable Operate guidance governs forms and staff workspaces; Taste remains the public art-direction reference rather than an instruction to decorate operational pages. Customer accounts use larger headings and more breathing room. Staff pages use a compact header, fixed type sizes, a persistent task navigation area, and dense reference labels. All displayed accounts, contacts, subjects, applications and permissions come from verified local Auth and scoped database reads. Unimplemented operational areas state their concrete prerequisites instead of showing activity or invented totals.

Implemented surfaces: sign-in, signup, email verification, authenticated password setup, public tutor-application entry, student/guardian account, tutor private-profile editing, customer-service account, and administration. Guardian invitations select explicit permissions; acceptance and revocation use real records. Admin application review shows the submitted biography and only submitted active subject choices. Role grants, invitations and current-role revocation use the authorized commands. A newly accepted staff role exposes its real workspace link after the server account refresh.

### Review findings resolved

- Removed manual record-version inputs. Invitation acceptance carries its fixed pending version internally; guardian and staff revocation select a current scoped record and use its saved version.
- Added cursor pagination and cancellation/generation checks. A response from an older page cannot append after refresh.
- Limited approval subject choices to the applicant's submitted active subjects.
- Refreshed verified account permissions after staff acceptance and exposed only currently authorized workspace links.
- Retained submitted fields and one logical command key across interrupted retries. Tab storage contains only a payload digest and random idempotency key, never form fields or invitation codes.
- Used fresh same-origin document navigation after authentication changes to discard cached account views. Forms retain POST semantics, and JavaScript-owned form controls and sign-out remain disabled until their client handlers are attached. Native navigation remains available.
- Kept form controls native, labeled and keyboard operable; field validation associates its error with the control. All four portal captures fit 360px without horizontal overflow.

The first CLI admin capture was taken before hydration finished. Playwright's default screenshot caret-hiding mutation caused a hydration warning. The final capture waits for client-loaded account data and uses `caret: 'initial'`. A clean named session then reported no application console errors or warnings. This was corrected in the inspection method rather than hidden with hydration suppression.

### Executed verification

- `pnpm typecheck`: exit 0 after the final functional changes.
- Scoped ESLint across the auth/identity components, portal pages and `tests/e2e/role-access.spec.ts`: exit 0, no warnings.
- Impeccable source detector: `detect --json src/components/identity-form.tsx src/components/identity-workspaces.tsx src/components/portal-shell.tsx src/components/auth.module.css`: exit 0, result `[]`.
- Initial focused form validation: 2 passed, desktop/mobile, 8.6s.
- First complete role run: 10 passed / 6 failed. Two failures were trace-file deletion from overlapping Playwright runners, two were a 5-second sign-in assertion timing out during cold rendering, and two expected 403 where private object access correctly returned 404. Separate output directories, response-aware sign-in waits, and exact contract assertions resolved these issues.
- The subsequent role run: 14 passed / 2 failed in 1.1m. Its only failures expected HTTP 200 for invitation creation after the transport contract correctly changed to HTTP 201.
- `pnpm test:e2e tests/e2e/role-access.spec.ts -g 'guardian invitation, acceptance' --output=.local/test-results-guardian`: 2 passed in 22.2s, exit 0. This exercised real invitation creation, acceptance in a separate authenticated browser, authorized learner access, selection of the saved guardian link, revocation and immediate denial in the existing guardian session. The token came from that disposable fixture's durable outbox; this is not guardian email-delivery evidence.
- Focused tutor-application review: 2 passed, including a real committed POST whose response was interrupted, a retry using the same key, exactly one saved application, denied self-approval, administrator review, approved-subject subset, and current-session access to the tutor portal.
- The first pagination regression fixture did not produce an admin next page because the query correctly excludes other applicants' reviewed history. The test fixture was corrected to use an isolated administrator's own history; no existing records were reset.
- `pnpm test:e2e tests/e2e/role-access.spec.ts -g 'refresh discards' --output=.local/test-results-pagination`: 2 passed in 6.4s, exit 0. It delays an actual page-two response, refreshes page one, proves the older result does not append, then proves fresh pagination works. Only newly created fixture rows are removed afterward.
- The database agent executed actual Mailpit signup verification and staff invitation/password/acceptance journeys: 4 passed in 14.2s, including the newly authorized Operations navigation link. This is local Auth/Mailpit evidence, not live SMTP readiness.
- The coordinating agent's first consolidated `pnpm check` passed 58 unit checks, 38 integration checks and 35 browser checks, but failed one desktop staff-acceptance journey. Database inspection confirmed its invitation remained pending: an enabled server-rendered button allowed a native POST before hydration. This failed run remains recorded; it is not a release pass.
- `pnpm test:e2e tests/e2e/role-access.spec.ts -g 'controls wait for hydration' --project=desktop --output=.local/test-results-hydration-red`: failed as intended before the fix. With Next.js JavaScript chunks deliberately held, the Sign in button was enabled. The failure evidence is retained in that output directory.
- Added the shared `useHydrated` hook using React's server/client external-store snapshots. Auth, signup, password setup and identity fieldsets/buttons, plus sign-out, remain disabled until hydration. Submit handlers also reject premature/repeated entry.
- `pnpm test:e2e tests/e2e/role-access.spec.ts -g 'controls wait for hydration' --output=.local/test-results-hydration-green`: **2 passed in 14.6s**, exit 0. Each desktop/mobile case delays scripts for login, signup, password setup and staff acceptance, checks disabled fields/buttons and sign-out, releases scripts and checks that the controls become enabled. Subsequent `pnpm typecheck` and scoped ESLint for the changed components/hook/test both exited 0.

The coordinating agent records the consolidated `pnpm check` result in `docs/IMPLEMENTATION-STATUS.md`; the individual results above do not substitute for that full run. Full booking, file, export, refund and financial acceptance cases remain with their owning milestones. No full GT-1601 or live-provider approval is inferred from these identity checks.

### Final CLI inspection

Official Playwright CLI 0.1.24, fresh named `git-tutor-ui` session using Edge. `.impeccable/t02-final-review.code.txt` loads genuine browser states created by actual test sign-ins from ignored `.local/ui-review/`; no authentication mock or role switcher is used. Credentials and cookies are excluded from inspection reports.

All four portals at desktop 1440px and mobile 360px: **no horizontal overflow, zero console errors, zero console warnings, and zero HTTP responses at or above 400** during the final capture. Customer RTL was additionally captured. Auth and portal screenshots were visually inspected for layout, form labels, readable references, real empty states, and consistent action hierarchy. Screenshots contain Next.js's normal development indicator; the previous red issue indicator is absent. These hydrated-state captures preceded the hydration-control guard; that guard changes only the transient pre-hydration/pending control state, which is covered by the delayed-script regression above.

Final artifacts (old admin captures overwritten with the current version-free controls):

- `.impeccable/review/auth-login-desktop.png` and `auth-login-mobile.png`.
- `.impeccable/review/t02-customer-desktop.png`, `t02-customer-mobile.png`, `t02-customer-rtl.png`.
- `.impeccable/review/t02-tutor-desktop.png` and `t02-tutor-mobile.png`.
- `.impeccable/review/t02-service-desktop.png` and `t02-service-mobile.png`.
- `.impeccable/review/t02-admin-desktop.png` and `t02-admin-mobile.png`.
- `.impeccable/review/t02-inspection.json` (sanitized outcome summary).

## T03 catalog and commercial editor — 2026-11-11

The catalog inherits the public red/ink/ivory identity, self-hosted Manrope, restrained motion and logical CSS. Taste informs the editorial subject and offer rows; Impeccable Operate informs the administrator's structured editor. The subject catalog derives only from published offer projections. Public tutor pages use approved profile versions; no private contact fields are passed to those components.

The `/admin/catalog` workflow separates customer tuition from privileged compensation. Saved pricing, policies, offers and tutor biographies populate real record selectors. Current versions stay inside commands. Private fee amounts are read from authorized server responses, never hard-coded into downloadable JavaScript or locale bundles. Native public filters work without JavaScript, while mutations inherit the verified hydration guard and persistent logical retry keys.

Package authoring belongs to this commercial-settings stage: the editor includes funding sources, eligible actual offers, included sessions, carrying purchase value, duration, coverage and expiry. Draft offers can establish eligibility before final policy approval. The server derives the owning package-policy identity. Public terms render the approved package values and coverage; purchase and reservation actions remain unavailable until their runtime milestones exist.

Executed so far: `pnpm typecheck` exited 0 after the complete initial implementation; scoped ESLint exited 0; Impeccable `detect --json src/components/catalog src/app/subjects src/app/offers src/app/tutors src/app/admin/catalog` exited 0 with `[]`. An intermediate typecheck caught implicit response/body inference in the paginated browser helper; explicit response typing resolved it.

`pnpm test:e2e tests/e2e/catalog.spec.ts -g 'approved tutor biography' --output=.local/test-results-catalog-profile` initially failed both cases because its helper added unsupported pagination parameters to the own-contact read. The API correctly rejected those unknown parameters. After fixing the helper, the same focused test with `--output=.local/test-results-catalog-profile-green` passed **2/2 desktop/mobile in 1.0m**. A fresh verified Auth account submitted an application, an administrator approved the exact biography through the UI, and the tutor edited the biography through the UI. The anonymous profile continued to show the previously approved version and excluded the private contact.

The first full catalog run (`pnpm test:e2e tests/e2e/catalog.spec.ts --output=.local/test-results-catalog`) passed both biography cases and failed four catalog/publication cases in 2.1m. Turbopack rejected the default re-export aliases used for loading routes; explicit default component wrappers replaced those aliases. The affected rerun then exposed two browser-helper problems: reading redirect response bodies as JavaScript, and selecting an older saved record before the first page of records had loaded. The helper now inspects actual HTTP-200 script bodies and waits for real initial/paginated results. These failures remain in their separate output directories.

Final focused verification:

- `pnpm test:e2e tests/e2e/catalog.spec.ts -g 'published catalog|administrator creates' --output=.local/test-results-catalog-publication-2`: **4 passed in 1.1m**. Anonymous and customer sessions exercised public filtering, terms, 360px/RTL layout, forbidden staff reads, and privacy in HTML, network DTOs and downloaded JavaScript. Actual administrator UI commands created pricing, approved it, created terms with zero deposit and a false guarantee, created an unpublished offer, configured a package against that real offer, approved the final policy and published the offer. Draft offers remained absent from public reads.
- A bounded rendered-review batch shortened the staff record list to a scrollable region, preserved readable contrast for approved values, fixed singular offer counts, corrected tutor-profile link directions, and used Next.js links for homepage catalog navigation. The coordinating agent's first consolidated check had stopped at that homepage-link lint error; no later stages ran in that attempt.
- Scoped ESLint including the homepage, catalog components/routes, locale files and browser suite: exit 0 after the review batch.
- `pnpm test:e2e tests/e2e/catalog.spec.ts -g 'administrator creates' --project=mobile --output=.local/test-results-catalog-mobile-review`: **1 passed in 24.7s**, confirming the complete workflow after the bounded list adjustment.

Official Playwright CLI 0.1.24, existing named `git-tutor-ui` Edge session, executed `.impeccable/t03-review.code.txt` against actual local Auth state and published data. The initial batched visual review and one final confirmation covered admin pricing, subjects, offers, offer terms and an approved tutor profile at 1440px and 360px. All five surfaces had **zero console errors, zero warnings and zero HTTP responses at or above 400** during the final capture. No 360px overflow occurred; all four public surfaces also passed the RTL overflow inspection. Images were opened and visually reviewed. The editor now stays reachable below a bounded mobile record selector, public tuition remains prominent, and the complete terms stay readable. The normal Next.js development indicator is visible in development screenshots.

Final artifacts: `.impeccable/review/t03-admin-desktop.png`, `t03-admin-mobile.png`, corresponding `t03-subjects-*`, `t03-offers-*`, `t03-offer-*` and `t03-tutor-*` desktop/mobile captures, plus `t03-offer-rtl.png`. `.impeccable/review/t03-inspection.json` contains the sanitized inspection outcome without cookies or credentials. Admin screenshots are internal development evidence and are not served from the public application.

The coordinating agent records the consolidated suite and production build in `docs/IMPLEMENTATION-STATUS.md`. The catalog does not claim scheduling, tutor assignment, package purchase or reservations; those actions remain explicitly unavailable until their owning milestones. These checks do not constitute full GT-1601, 200% browser-zoom or live commercial-policy approval.

## T04 booking and scheduling — local UI verified, integration checkpoint pending

The booking screens extend the existing public editorial style and the denser staff workspace. Customer pages use named learners from current booking scope, show Cairo session times, and separate a temporary hold from exact quote consent. A public session selection survives verified sign-in through a narrowly validated booking-only return path. Customer API reads explicitly select the customer proposal view even when an account has another role. Tutor compensation stays in separate staff components and authorized reads; customer bundles do not import the compensation manifest.

Tutor availability uses structured weekly intervals and dated exceptions. Invalid or repeated Cairo local times are handled through the shared timezone resolver; ambiguous instants need an explicit offset. A failed edit preserves entered hours and shows the affected session's actual Cairo time through a scoped exact-record read. Admin scheduling selects actual published offers and approved tutors. Exact fee approval resolves the saved approved pricing record through pagination, while group changes select compatible approved policies and saved prospective agreements. Versions and hashes remain inside commands.

Parent review identified two workflow corrections: a temporary seat cannot be released while its financial integration is unavailable, so the release control is disabled with a clear prerequisite; a last-seat conflict now preserves a notice and learner selection while refreshing current availability, exposing explicit waiting-list consent without automatically joining. A proposal review also exposed an ordinary-quote acceptance gap for provisional seats. The UI now labels the proposed seat and exposes only scoped amendment consent; the database guard now rejects ordinary quote acceptance for a provisional seat, and the actual browser regression confirms scoped amendment consent remains available.

Executed independent browser evidence so far (each output directory preserves its actual outcome):

- `pnpm test:e2e tests/e2e/booking.spec.ts --project=desktop --output=.local/test-results-booking-red`: 1 expected failure before the routes existed. The same protected-route case then passed in `.local/test-results-booking-boundaries` (1/1, 13.3s).
- First real scheduling/conflict run: 2 failures. A test locator matched a named reference region and its select; the second ran before the exact conflict-record read was fully deployed. The locator was scoped to its form and the three agreed exact-ID reads were then applied.
- `.local/test-results-booking-core-second`: 1 passed / 4 failed. The failures exposed a global alert locator matching Next's route announcer, cold nested-route compilation taking 6.4s before navigation, an unloaded older saved-pricing record leaving fee approval disabled, and a test comparing two equivalent UTC string representations. The UI now automatically resolves its pinned pricing record, loading routes are explicit default components, and tests wait for navigation and compare instants.
- `.local/test-results-booking-core-third`: 4 passed / 2 failed. Verified protected routes, public-session login continuation, actual restricted-worker waiting-list expiry/promotion and tutor conflict preservation. Remaining test failures were a global reservation-link assertion including historical bookings, and a DevTools response handle lost on full-document navigation.
- `pnpm test:e2e tests/e2e/booking.spec.ts tests/e2e/booking-concurrency.spec.ts -g 'administrator schedules|independent browsers' --project=desktop --output=.local/test-results-booking-core-fourth`: 2 passed in 42.8s. The actual administrator scheduled a session and approved an exact fee. A guardian held two separate learner seats and accepted each quote; unrelated reads returned 404. Customer HTML, DTOs and every exact browser-observed HTTP-200 JavaScript asset were checked for privileged fields. Independent browser contexts received one successful last-seat reservation and one conflict, with no implicit waitlist entry.
- `.local/test-results-booking-mobile-first`: 5 passed / 1 failed in 1.0m. The failed test's private fixture lookup assumed canonical pricing was within the first 100 rows; the helper now follows actual pagination. This result is not a full mobile pass.
- Scoped TypeScript and ESLint checks exited 0 at the recorded implementation checkpoints. They will run again with the final workflow changes.

Final local evidence:

- The first Node 24 proposal run (`pnpm test:e2e tests/e2e/booking.spec.ts -g 'group change|reviewed cancellation|schedule-only' --project=desktop --output=.local/test-results-booking-proposals-node24-first`) passed two cases and failed one. Actual learner and tutor responses were accepted, but the test could not locate an implicitly labelled approval select. An explicit label/id association fixed the control. No approval request or financial commit was falsely recorded by the failed run.
- `pnpm test:e2e tests/e2e/booking.spec.ts -g 'schedule-only|public scheduled' --project=desktop --output=.local/test-results-booking-proposal-node24-second`: **2 passed in 18.2s**. The approved schedule-only change preserved customer tuition and quote consent; public Cairo time filtering and verified sign-in continuation worked.
- `pnpm test:e2e tests/e2e/booking.spec.ts tests/e2e/booking-concurrency.spec.ts --output=.local/test-results-booking-node24-final`: **18 passed in 1.8m**, desktop and 360px mobile, with two workers and no retries. This includes actual structured scheduling and exact fee approval, separate guardian learner quotes, customer HTML/API/downloaded-script privacy, unrelated-record denial, conflicting availability with affected-session links, provisional group-change consent, blocked unknown financial consent, reviewed schedule-only application, independent last-seat races, and restricted-worker waiting-list expiry/promotion.
- The bounded rendered review found English date/time fragments reordered under RTL and a generic pagination button referring to sessions when reading pricing. Shared date/time rendering now uses directional isolation, and pagination says “Load more results.” One focused rerun did not start while a transient UTF-8 edit prevented the existing development server from compiling; the encoding was corrected before the subsequent run. `pnpm test:e2e tests/e2e/booking.spec.ts -g 'administrator schedules|group change' --output=.local/test-results-booking-review-node24-green`: **4 passed in 51.8s**, covering the changed customer/staff displays and paginated record selection on desktop/mobile.
- Final `pnpm typecheck` and scoped ESLint exited 0. Impeccable 4.3.1 `detect --json src/components/booking src/app/learn/bookings src/app/admin/schedule src/app/tutor/schedule src/app/offers` exited 0 with `[]`.

Earlier implementation checks used shell Node 22.22.2. The final 18-case run, four post-review checks and official Playwright CLI review used pinned Node 24.22.1 (ICU 78.3, timezone data 2026e), by prepending the bundled executable directory to the process PATH. The system PATH was not changed.

Official Playwright CLI 0.1.24, named `git-tutor-ui` Edge session, executed `.impeccable/t04-review.code.txt` with genuine saved local Auth states and current synthetic records. The bounded review covers customer reservation and exact quote, provisional seat and amendment terms, admin roster and confidential terms, tutor availability and its rejected conflict. Captures at 1440px and 360px have no horizontal overflow. All four customer views also passed the RTL overflow inspection. Keyboard inspection showed visible solid 3px focus outlines on links, buttons and disclosure controls. Screenshot framing was corrected to show the mobile quote itself and avoid carrying the focused skip link over the next surface. Screenshots were opened for visual review.

Console/network accounting: ordinary customer and admin surfaces had no console errors, warnings or HTTP failures. The deliberately conflicting tutor edit returned **409 from `/api/v1/availability`**, with the corresponding browser resource-error console entry; this expected rejection is retained in the report. There were no unexpected HTTP failures, JavaScript exceptions or warnings. The rejected change preserves the entered exception and displays a scoped link with the affected session’s actual Cairo time.

Artifacts live under `.impeccable/review/`: `t04-customer-reservation-*`, `t04-customer-quote-*`, `t04-provisional-seat-*`, `t04-provisional-terms-*`, `t04-admin-schedule-*`, `t04-admin-private-*`, `t04-tutor-availability-*`, and `t04-tutor-conflict-*`, with desktop/mobile variants and RTL customer captures. The final sanitized inspection is `t04-inspection-final.txt`; genuine session storage stays in ignored `.local/ui-review/`. Internal administrator screenshots are development evidence and are not served publicly.

The coordinating agent records the consolidated suite separately. T04 remains **awaiting_T06_integration**: funded confirmation, financial amendment commit, settled cancellations, package funding, live provider delivery and the combined T04–T06 acceptance checkpoint remain unverified. The waiting-list walkthrough used real worker processing and durable local state; it does not establish live notification delivery. These focused browser checks do not mark complete GT acceptance cases or full accessibility/Arabic-translation certification.

The first consolidated T04 check passed 194 unit checks, 100 integration checks and 72 of 74 browser checks; the build did not run after the two failures. Both failing catalog privacy cases were the same DevTools response-body lifetime defect already addressed in the booking test: a full-document filter navigation invalidated a stored response handle. The catalog test now collects the exact browser-observed HTTP-200 script URLs and inspects each through its original browser context, requiring a nonempty asset set, HTTP 200 and absence of every prohibited field. No failure is caught or skipped. `pnpm test:e2e tests/e2e/catalog.spec.ts -g 'published catalog' --output=.local/test-results-t04-catalog-privacy-green` then passed **2/2 desktop/mobile in 13.8s** on Node 24; scoped ESLint and whitespace checks exited 0. The failed consolidated log is preserved as `docs/evidence/t04-check-first-failed.log`; the coordinating agent owns the subsequent full result.
