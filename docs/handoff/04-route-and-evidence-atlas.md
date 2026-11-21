# Route and evidence atlas

Use this index when a colleague gives you a URL, a role or a symptom. Each Source link opens the actual entry point. Follow its component import or route dispatch to the domain module, then examine the transaction and the relevant tests. A route existing in the repository does not grant access to a user or establish that its live provider is enabled.

As of 19 November there are **75 page entry points and 20 HTTP route modules**. Several HTTP modules dispatch many operations. Brackets denote a dynamic segment, and a catch-all can consume more than one segment. Page routes below use examples of URL patterns without any real record identifiers. The public home contains the how-it-works and FAQ sections. The specification's standalone policy pages still need a product and content decision before public launch. [App source](../../src/app) · [API contracts](../05-api-contracts.md)

## Public site and account screens

| Route | Purpose | Code |
|---|---|---|
| `/` | Home, study formats, how it works, FAQs, contact links and entry into the tutoring request. | [Source](../../src/app/page.tsx) |
| `/subjects` | Flexible study areas. Each selection starts a request with a topic suggestion. A learner may supply another subject. | [Source](../../src/app/subjects/page.tsx) |
| `/offers` | Public price comparison for one student or a group of two, three or four. | [Source](../../src/app/offers/page.tsx) |
| `/offers/[id]` | One published offer with its saved terms and availability. Staff-matched booking paths can still use this detail view. | [Source](../../src/app/offers/%5Bid%5D/page.tsx) |
| `/tutors/[id]` | Published tutor profile and customer-safe teaching details. | [Source](../../src/app/tutors/%5Bid%5D/page.tsx) |
| `/apply-to-teach` | Application entry and signed-in tutor application form. Staff review takes place in admin. | [Source](../../src/app/apply-to-teach/page.tsx) |
| `/support` | Public support conversation, help content and direct contact choices. | [Source](../../src/app/support/page.tsx) |
| `/login` | Sign in and follow a supported customer return path or role destination. | [Source](../../src/app/login/page.tsx) |
| `/signup` | Account creation entry. Environment-specific Auth policy controls whether registration can proceed. | [Source](../../src/app/signup/page.tsx) |
| `/auth/verify` | Instructions after account creation. The actual token exchange runs in the callback handler. | [Source](../../src/app/auth/verify/page.tsx) |
| `/auth/set-password` | Set a password after an authenticated invitation or recovery callback. | [Source](../../src/app/auth/set-password/page.tsx) |

## Student, guardian and payer screens

| Route | Purpose | Code |
|---|---|---|
| `/learn` | Learning overview. Select or manage an authorized learner and open the request entry. | [Source](../../src/app/learn/page.tsx) |
| `/learn/requests` | Draft a brief, upload private materials, submit it, respond to staff and follow the proposed session. | [Source](../../src/app/learn/requests/page.tsx) |
| `/learn/bookings` | Choose an eligible learner, review a matched slot, reserve a seat and inspect reservations or waitlist offers. | [Source](../../src/app/learn/bookings/page.tsx) |
| `/learn/bookings/[id]` | Enrollment detail. The next action depends on quote, hold, funding and meeting state. Files, changes and terms are accessible here. | [Source](../../src/app/learn/bookings/%5Bid%5D/page.tsx) |
| `/learn/files` | View authorized private preparation files and published resources for teaching sessions. | [Source](../../src/app/learn/files/page.tsx) |
| `/learn/grades` | Download available quiz PDFs across confirmed sessions and view private scores for each authorized learner. | [Source](../../src/app/learn/grades/page.tsx) |
| `/learn/packages` | Browse available contracts and purchased credits for the selected learner. | [Source](../../src/app/learn/packages/page.tsx) |
| `/learn/packages/[id]` | Inspect quantities and value, movements, expiry, permitted renewal or transfer actions. | [Source](../../src/app/learn/packages/%5Bid%5D/page.tsx) |
| `/learn/payments` | Find customer obligations, receipts, payment plans and owned transfers within scope. | [Source](../../src/app/learn/payments/page.tsx) |
| `/learn/payments/charges/[id]` | View collection instructions for a specific charge and submit transfer evidence. | [Source](../../src/app/learn/payments/charges/%5Bid%5D/page.tsx) |
| `/learn/payments/[id]` | Receipt detail and progress through review. The ID identifies a receipt. | [Source](../../src/app/learn/payments/%5Bid%5D/page.tsx) |
| `/learn/payments/transfers/[id]` | Original payer's transfer view with eligible balances and payment decisions. | [Source](../../src/app/learn/payments/transfers/%5Bid%5D/page.tsx) |
| `/learn/payments/plans/[id]` | Inspect and accept the proposed distribution of the payer's funds. | [Source](../../src/app/learn/payments/plans/%5Bid%5D/page.tsx) |
| `/learn/payments/enrollment-transfer-consents/[id]` | Original payer's explicit consent to carrying funds to a proposed replacement session. | [Source](../../src/app/learn/payments/enrollment-transfer-consents/%5Bid%5D/page.tsx) |
| `/learn/refunds` | Customer refund history and current requests. | [Source](../../src/app/learn/refunds/page.tsx) |
| `/learn/refunds/[id]` | One scoped refund, status and authorized next actions. | [Source](../../src/app/learn/refunds/%5Bid%5D/page.tsx) |
| `/learn/notifications` | The signed-in recipient's operational updates. | [Source](../../src/app/learn/notifications/page.tsx) |
| `/learn/support` | Authenticated customer conversation and staff handoff. | [Source](../../src/app/learn/support/page.tsx) |
| `/learn/exports` | Request and retrieve an authorized customer export with its saved filters. | [Source](../../src/app/learn/exports/page.tsx) |

## Tutor screens

| Route | Purpose | Code |
|---|---|---|
| `/tutor` | Teaching workspace and tutor profile. Imported teaching history is available where the account has mappings. | [Source](../../src/app/tutor/page.tsx) |
| `/tutor/schedule` | Availability and assigned occurrences, teaching terms, files and meeting access. | [Source](../../src/app/tutor/schedule/page.tsx) |
| `/tutor/teaching` | Operational issues, reassignment and teaching follow-up for the tutor's permitted sessions. | [Source](../../src/app/tutor/teaching/page.tsx) |
| `/tutor/quizzes` | Assign a checked PDF to a teaching session, publish a learner's score and make a versioned correction. | [Source](../../src/app/tutor/quizzes/page.tsx) |
| `/tutor/pay` | Own earnings, adjustments, payout history and destination workflow. | [Source](../../src/app/tutor/pay/page.tsx) |
| `/tutor/notifications` | The tutor's operational messages. | [Source](../../src/app/tutor/notifications/page.tsx) |
| `/tutor/exports` | Authorized tutor exports, including own records where the export scope permits. | [Source](../../src/app/tutor/exports/page.tsx) |

## Customer-service screens

| Route | Purpose | Code |
|---|---|---|
| `/service` | Operations overview and request entry. Workbook observations appear when enabled for the current operator. | [Source](../../src/app/service/page.tsx) |
| `/service/requests` | Review request briefs, request clarification and propose an eligible scheduled session. | [Source](../../src/app/service/requests/page.tsx) |
| `/service/customers` | Scoped customer register, relationships, history and follow-ups. | [Source](../../src/app/service/customers/page.tsx) |
| `/service/payments` | Review queue with cases, ownership and reported workbook history. | [Source](../../src/app/service/payments/page.tsx) |
| `/service/payments/[id]` | Claim or act on a specific review case using the permitted evidence. | [Source](../../src/app/service/payments/%5Bid%5D/page.tsx) |
| `/service/payments/incoming` | Look up incoming funds and independent settlement evidence. | [Source](../../src/app/service/payments/incoming/page.tsx) |
| `/service/payments/imports/[id]` | Statement import detail and allowed review actions. | [Source](../../src/app/service/payments/imports/%5Bid%5D/page.tsx) |
| `/service/payments/transfers/[id]` | Inspect the identified incoming transfer and its reconciliation state. | [Source](../../src/app/service/payments/transfers/%5Bid%5D/page.tsx) |
| `/service/notifications` | Own service notifications. | [Source](../../src/app/service/notifications/page.tsx) |
| `/service/support` | Human support inbox with claims, assignments and conversation replies. | [Source](../../src/app/service/support/page.tsx) |

## Administrator screens

| Route | Purpose | Code |
|---|---|---|
| `/admin` | Business overview, workbook charts and drill-down, request queue and daily operations. Contents depend on authorized data. | [Source](../../src/app/admin/page.tsx) |
| `/admin/access` | Review teaching applications and staff access. Sensitive commands independently verify owner/actor permissions. | [Source](../../src/app/admin/access/page.tsx) |
| `/admin/requests` | Review tutoring requests and material, ask for changes, and propose a match. | [Source](../../src/app/admin/requests/page.tsx) |
| `/admin/catalog` | Author and publish catalog and policy versions, including the privileged commercial settings. | [Source](../../src/app/admin/catalog/page.tsx) |
| `/admin/schedule` | Schedule occurrences, allocate capacity, approve teaching agreements and process proposals. | [Source](../../src/app/admin/schedule/page.tsx) |
| `/admin/sessions` | Session directory with filters, operational history and imported history where enabled. | [Source](../../src/app/admin/sessions/page.tsx) |
| `/admin/teaching` | Manage teaching operations and exceptional changes. | [Source](../../src/app/admin/teaching/page.tsx) |
| `/admin/packages` | Contracts, purchases, credit events and review of package exceptions. | [Source](../../src/app/admin/packages/page.tsx) |
| `/admin/payments` | Incoming money, collection accounts, statement imports and transfer actions allowed to the operator. | [Source](../../src/app/admin/payments/page.tsx) |
| `/admin/payments/imports/[id]` | Inspect an individual bank or wallet statement import. | [Source](../../src/app/admin/payments/imports/%5Bid%5D/page.tsx) |
| `/admin/payments/reviews` | Payment review case queue. | [Source](../../src/app/admin/payments/reviews/page.tsx) |
| `/admin/payments/reviews/[id]` | Inspect a specific review case and decide the permitted action. | [Source](../../src/app/admin/payments/reviews/%5Bid%5D/page.tsx) |
| `/admin/payments/transfers/[id]` | Incoming transfer details, evidence and remaining source balance. | [Source](../../src/app/admin/payments/transfers/%5Bid%5D/page.tsx) |
| `/admin/payments/reconciliation` | Inspect financial exceptions and unresolved reconciliation cases. | [Source](../../src/app/admin/payments/reconciliation/page.tsx) |
| `/admin/refunds` | Review refund requests and their settlement progress. | [Source](../../src/app/admin/refunds/page.tsx) |
| `/admin/refunds/[id]` | Refund detail, authorization and evidence for the selected record. | [Source](../../src/app/admin/refunds/%5Bid%5D/page.tsx) |
| `/admin/pay` | Tutor agreements' downstream payroll effects, earnings, verified destinations, payout attempts and settlement. | [Source](../../src/app/admin/pay/page.tsx) |
| `/admin/finance` | Finance controls, postings and reconciled reporting. Imported reported balances are distinguished from operating transactions. | [Source](../../src/app/admin/finance/page.tsx) |
| `/admin/customers` | Customer register, relationships, case history and follow-ups. | [Source](../../src/app/admin/customers/page.tsx) |
| `/admin/students` | Learner progression and first-attendance reporting. | [Source](../../src/app/admin/students/page.tsx) |
| `/admin/team` | Staff workload and operational follow-up. | [Source](../../src/app/admin/team/page.tsx) |
| `/admin/campaigns` | Campaign attribution, cohorts and source drill-down. | [Source](../../src/app/admin/campaigns/page.tsx) |
| `/admin/workflow` | Owner-authorized source workbook archive and mapping review. | [Source](../../src/app/admin/workflow/page.tsx) |
| `/admin/exports` | Create and inspect scoped export jobs and their authorized results. | [Source](../../src/app/admin/exports/page.tsx) |
| `/admin/support` | Support inbox, ownership and exceptional handling. | [Source](../../src/app/admin/support/page.tsx) |
| `/admin/integrations` | Organizer connection, refresh or revocation and recorded live verification. | [Source](../../src/app/admin/integrations/page.tsx) |
| `/admin/notifications` | The signed-in administrator's personal inbox. | [Source](../../src/app/admin/notifications/page.tsx) |
| `/admin/notifications-operations` | Inspect delivery operations, failures and reconciliation. | [Source](../../src/app/admin/notifications-operations/page.tsx) |

## HTTP entry points

Use the method column to locate the exported handler. The shared gateway additionally checks allowed subpaths, schemas, the origin where applicable and current authority. A single GET or POST export can represent many authorized operations.

| Handler | Methods | Responsibility |
|---|---|---|
| `/healthz` | GET | Process liveness. A successful response establishes the web process is responding. [Source](../../src/app/healthz/route.ts) |
| `/auth/callback` | GET | Exchange the supported Auth callback, validate the next step and establish the account session. [Source](../../src/app/auth/callback/route.ts) |
| `/api/auth/[action]` | POST | Login, signup, logout and password actions with origin and input checks. [Source](../../src/app/api/auth/%5Baction%5D/route.ts) |
| `/api/calendar/connect` | POST | Begin the authorized organizer connection. [Source](../../src/app/api/calendar/connect/route.ts) |
| `/api/calendar/google/callback` | GET | Validate the organizer's callback and save the server-side authorization. [Source](../../src/app/api/calendar/google/callback/route.ts) |
| `/api/v1/me` | GET | Read the current user's account, roles and authorized scope. [Source](../../src/app/api/v1/me/route.ts) |
| `/api/v1/[...path]` | GET, POST | Shared dispatcher for identity, catalog, booking, packages, payments, teaching, finance, files and related commands. Its branches and dedicated handlers define the accepted paths. [Source](../../src/app/api/v1/%5B...path%5D/route.ts) |
| `/api/v1/requests/[[...path]]` | GET, POST | Request creation, review, attachments, resubmission and match actions. [Source](../../src/app/api/v1/requests/%5B%5B...path%5D%5D/route.ts) |
| `/api/v1/files/[id]/content` | GET, PUT | Private file upload or download bytes. The content route rechecks current authorization. [Source](../../src/app/api/v1/files/%5Bid%5D/content/route.ts) |
| `/api/v1/learning-records/[occurrenceId]` | GET, POST | Read or update the learning record using the allowed view and relationship. [Source](../../src/app/api/v1/learning-records/%5BoccurrenceId%5D/route.ts) |
| `/api/v1/crm/[[...path]]` | GET, POST | Directory, contact, relationship, history and follow-up reads and commands. [Source](../../src/app/api/v1/crm/%5B%5B...path%5D%5D/route.ts) |
| `/api/v1/exports/[[...path]]` | GET, POST | Submit exports, inspect jobs and deliver an authorized result. [Source](../../src/app/api/v1/exports/%5B%5B...path%5D%5D/route.ts) |
| `/api/v1/analytics/[...path]` | GET, POST | Campaigns, inquiries, cohorts, workload and scoped analytics commands. Finance has a dedicated server handler behind the shared gateway. [Source](../../src/app/api/v1/analytics/%5B...path%5D/route.ts) |
| `/api/v1/notifications/[[...path]]` | GET, POST | Recipient inbox operations and privileged notification administration. [Source](../../src/app/api/v1/notifications/%5B%5B...path%5D%5D/route.ts) |
| `/api/v1/support/[[...path]]` | GET, POST | Website conversation, ownership, messages and human handoff actions. [Source](../../src/app/api/v1/support/%5B%5B...path%5D%5D/route.ts) |
| `/api/v1/workflow-import` | GET | Read the privileged workbook source archive. [Source](../../src/app/api/v1/workflow-import/route.ts) |
| `/api/v1/workflow-operations` | GET, POST | Return role-scoped operational workbook sections or accept an authorized source-mapping review. [Source](../../src/app/api/v1/workflow-operations/route.ts) |
| `/api/webhooks/email` | POST | Receive supported signed email callbacks using the configured provider path. [Source](../../src/app/api/webhooks/email/route.ts) |
| `/api/webhooks/resend` | POST | Receive and verify a Resend notification callback when that adapter is selected. [Source](../../src/app/api/webhooks/resend/route.ts) |
| `/api/webhooks/whatsapp` | GET, POST | Handle Meta verification challenges and signed incoming event payloads. [Source](../../src/app/api/webhooks/whatsapp/route.ts) |

## Requirement-to-test index

Use these as starting points for changing behavior. A test file may exercise only a subset of the requirement. The acceptance maps record the required variants, including cases still awaiting literal evidence. [Requirements](../00-contract-spine.md) · [T01–T06 acceptance map](../T01-T06-ACCEPTANCE-MAP.md) · [T07–T09 and T13 acceptance map](../T07-T09-T13-ACCEPTANCE-MAP.md)

| Requirement | Question to answer when reviewing a change | Starting evidence |
|---|---|---|
| R01 · Public UI | Can a mobile visitor browse flexible subjects, see session pricing and reach a request with a keyboard? | [Public browser tests](../../tests/e2e/subjects.spec.ts) |
| R02 · Identity | Does a verified account still have the current role and relationship for this particular learner? | [Role and guardian browser tests](../../tests/e2e/role-access.spec.ts) |
| R03 · Catalog | Is the accepted price version stable and does every customer projection exclude privileged commercial data? | [Catalog privacy](../../tests/integration/catalog-privacy.test.ts) |
| R04 · Booking | With independent users competing for a last seat, can only one obtain a valid hold? | [Booking concurrency](../../tests/e2e/booking-concurrency.spec.ts) |
| R05 · Packages | Do quantity and carrying value survive reservation, consumption, expiry and renewal? | [Package ledger](../../tests/integration/package-ledger.test.ts) |
| R06 · Reconciliation | Is the receipt current, the incoming money independently settled, the reviewer authorized and the amount available? | [Reviewer authority](../../tests/integration/payment-authority.test.ts) · [Payment allocations](../../tests/integration/payment-allocations.test.ts) |
| R07 · Refunds | Does an approved remedy belong to the right customer and spend the same source funds only once? | [Remedy ownership](../../tests/integration/refund-remedy-ownership.test.ts) · [Refund concurrency](../../tests/integration/refund-concurrency.test.ts) |
| R08 · Scheduling and Meet | Does the worker act on the current event generation, and can the authorized participant get current access? | [Calendar integration](../../tests/integration/calendar.test.ts) |
| R09 · File privacy | Is this exact file clean, published where required and still accessible to this account? | [File boundary](../../tests/integration/files.test.ts) · [Materials browser flow](../../tests/e2e/session-materials.spec.ts) |
| R10 · Delivery | Can an approved completion and any correction be traced to actual teaching and attendance? | [Completion](../../tests/integration/completion.test.ts) · [Learning records](../../tests/integration/learning-records.test.ts) |
| R11 · Tutor pay | Is the earning tied to the approved agreement, and is a payout allocated only once? | [Payroll](../../tests/integration/payroll.test.ts) · [Payout race](../../tests/integration/payroll-concurrency.test.ts) |
| R12 · CRM and exports | Can the recipient export only authorized rows and safe fields for the chosen filter? | [CRM and exports](../../tests/integration/crm-exports.test.ts) |
| R13 · Finance | Do totals at the requested cutoff reconcile to the supporting transactions? | [Finance report controls](../../tests/integration/finance-report-controls.test.ts) |
| R14 · Notifications | Is the current recipient eligible at send time, and can retries be reconciled? | [Notification integration](../../tests/integration/notifications.test.ts) |
| R15 · Support | Does a human claim stop automated replies and preserve channel consent and ownership? | [Support and WhatsApp](../../tests/integration/support-whatsapp.test.ts) |
| R16 · Progress | Does acquisition require first eligible attendance, and are returning and unknown learners represented? | [Analytics tests](../../tests/integration/analytics.test.ts) |
| R17 · Recovery and controls | Does restart respect job leases, held money, private objects and unresolved provider outcomes? | [Worker recovery](../../tests/integration/worker-recovery.test.ts) · [Hosted-source rehearsal](../evidence/hosted-source-recovery-20261115.md) |
| R18 · Evidence | Can a second engineer reproduce the exact assertion, environment, commit and artifact recorded as passing? | [Evidence validator tests](../../tests/unit/evidence.test.ts) · [Evidence protocol](../EVIDENCE-WORKFLOW.md) |

## Presentation and assets

The deployed logo comes from the authorized Instagram profile image. The browser serves a local 150 × 150 JPEG. Use the recorded asset hash and provenance when replacing or inspecting it. Site-wide type and color live in the root stylesheet. Portal navigation groups destinations by signed-in workspace and collapses to a keyboard-accessible menu on phones. The learner reservation moves the appropriate quote, payment or room action upward. The administrator's workbook overview connects each chart choice to its underlying records. The English interface and RTL layout checks are documented. Full Arabic localization requires its own translated copy and verification. [Brand asset](../BRAND-ASSETS.md) · [Global styles](../../src/app/globals.css) · [Portal navigation](../../src/components/portal-navigation.tsx) · [Browser design evidence](../DESIGN-REVIEW.md)

The small Giza accent in the public footer loads Three.js when the element approaches the viewport. The procedural model has a dedicated factory. The component is hidden from assistive technology, handles unavailable WebGL and releases renderer resources on unmount. Keep the decoration independent of pricing, sign-in and requests. Reference provenance, model spec and render reviews live together in the design evidence. [Accent component](../../src/components/giza-accent.tsx) · [Model factory](../../src/components/giza-model.ts) · [Tooling record](../TOOLING-EVIDENCE.md)

## Glossary for handover conversations

| Term | Meaning in this project |
|---|---|
| Account, learner, guardian, payer | An account signs in. A learner receives teaching. A verified relationship permits a guardian to act for a learner. The original payer owns the relevant transfer and may have to consent separately. |
| Offer, occurrence, enrollment | An offer describes terms for a service. An occurrence is a scheduled class. An enrollment is one learner's place in that class. A change affecting one of these records may require fresh authority or consent for another. |
| Quote and agreement | Customers accept a versioned tuition quote. An exact privileged tutor agreement records the teaching terms. Both feed confirmation through separate approvals and projections. |
| Receipt, transfer, allocation | A receipt is customer-supplied proof. A transfer represents incoming money with its own status and independent evidence. An allocation applies part of eligible funds to a particular obligation. |
| Minor units and credit quanta | Monetary records use integer minor units with a currency. Packages additionally track integer teaching quantities. One full session credit uses 1,000 quanta. Quantity and money have distinct conservation rules. |
| Source row and canonical record | The former identifies what a source sheet reported. The latter has a system identity and current workflow history. A reviewed mapping connects them. |
| Outbox and provider reconciliation | A committed transaction records work for a background worker. When a remote result is uncertain, reconciliation determines whether retrying could duplicate an external side effect. |
| RPO and RTO | Recovery point objective is tolerable data loss measured in time. Recovery time objective is tolerable downtime. The owner selects production targets and the team measures an actual restore. |

## Cleanup inventory

| Item reviewed | Action and rationale |
|---|---|
| Root implementation briefs | Removed the unused duplicate `GitTutor-Codex-Start.md` after matching its Git blob to [the canonical startup brief](../../CODEX-START.md) and checking references. |
| Obsolete public offer listing | Removed the unreferenced `src/components/catalog/offer-list.tsx`. The current pricing page uses the tuition comparison. Published per-offer details continue to serve matched bookings. The route index above distinguishes both entry points. |
| Local component styles | Compared CSS-module exports to the TypeScript imports and property uses before removing unused selectors in the auth, booking, catalog and payment stylesheets. Preserved active selectors in shared rules. |
| Current versus historical operator instructions | Replaced expired tunnel links with the stable testing address or isolated localhost as appropriate. Updated the README, demo, release decision, deployment, selected sender and Calendar guidance. Historical test evidence stays in its dated records. |
| Similar-looking files with distinct responsibilities | Next route boundaries, applied migration files including zero-byte historical versions, separate run logs and 3D review evidence retain their original paths. Matching content can represent separate route behavior, database versions or independent checks. |
| Machine-specific and customer material | Ignored workspaces include private sign-ins, datasets, configuration, backups and operator evidence. The handoff contains code and documentation references only. A fresh clone and individually granted access are the transfer mechanism. |
